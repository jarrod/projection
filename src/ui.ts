// defineUi: the one entry point. Bolts a human UI onto an existing McpServer without touching agent-facing tools.
// The server keeps no per-viewer state: a viewer sends its view params and the hash of what it shows, and gets HTML back if that differs.
import { z } from "zod";
import { RUNTIME, WEB, CSS } from "./assets.js";
import { createWeb, type WebOptions } from "./web.js";
import { isHtml, type Html } from "./html.js";

export const MCP_APP_MIME = "text/html;profile=mcp-app";
const SYNC = "p_sync";
const FROM_WEB = Symbol("web"); // marks the `extra` of a tool call made from a browser session

/** View state. Lives in the viewer's browser; changed with `set` on a Button, Input, Form or Menu item. */
export type Params = Record<string, any>;
export type ViewCtx = {
  /** Who is viewing: the MCP user (authInfo), also on the web, where the link carries it. */
  user: string;
  params: Params;
};
export type View = (ctx: ViewCtx) => Html | Promise<Html>;
export type SyncState = { params?: Params; h?: string; v?: number };
export type SyncResult = { v: number; h: string; html?: string };

export type UiOptions = {
  /** Short name, used for the default resource URI ui://<name>/app.html. */
  name: string;
  /** The UI: a function of the viewer and their view params that returns HTML. Runs again after every tool call. */
  view: View;
  /** Existing tools whose results should open the UI in MCP Apps hosts (adds _meta.ui.resourceUri). */
  attachTo?: string[];
  /** Extra CSS appended after the kit. */
  css?: string;
  /** Skip the built-in kit CSS entirely. */
  bare?: boolean;
  /** Map an MCP request to a stable user id. Default: authInfo.extra.sub, or "local" when the request carries no auth.
   *  An authenticated request with no subject throws: a client id names the agent app, not the person using it. */
  identify?: (extra: any) => string;
  /** Override the ui:// URI. */
  uri?: string;
  /** The same UI on a normal URL, reached through single-use links. On by default. Without `origin` it is served on this
   *  machine only (127.0.0.1, a free port); for a hosted server give `origin` and serve ui.site.node or ui.site.fetch there.
   *  `false` turns web mode off. */
  web?: false | (WebOptions & {
    /** Model-visible tool that opens the UI in the user's browser (URL elicitation, link fallback).
     *  Default `open_<name>_in_browser`; `false` for none. */
    tool?: string | false;
    toolDescription?: string;
  });
};

/** The part of an MCP request's `extra` that this library reads. */
export type Extra = {
  authInfo?: { clientId?: string; expiresAt?: number; extra?: Record<string, unknown> };
  requestId?: string | number;
  signal?: AbortSignal;
  [FROM_WEB]?: true;
};
type ToolCall = (request: any, extra: any) => Promise<any>;
type ServerLike = { registerTool: (...a: any[]) => any; registerResource: (...a: any[]) => any; server: any };

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
const method = (schema: any) => { const m = schema?.shape?.method; return m?.value ?? m?._zod?.def?.values?.[0]; };

export function defineUi(o: UiOptions) {
  const uri = o.uri ?? `ui://${o.name}/app.html`;
  const identify = (extra?: Extra): string => {
    const a = extra?.authInfo, user = o.identify ? o.identify(extra) : a ? a.extra?.sub : "local";
    // No id means no user: never fall back to a shared one. A client id names the agent app, not the person using it.
    if (user == null || user === "") throw new Error("No user id: set authInfo.extra.sub in your token verifier, or return one from defineUi({ identify }).");
    return String(user);
  };
  const css = (o.bare ? "" : CSS) + (o.css ?? "");
  if (/<\/style/i.test(css)) throw new Error("css must not contain </style");
  const calls = new WeakMap<object, ToolCall>();
  const w = o.web === false ? undefined : o.web ?? {};
  const tool = w && w.tool !== false ? w.tool ?? `open_${o.name.replace(/[^\w-]/g, "_")}_in_browser` : undefined;

  // ---- change signal: one counter, and the viewers waiting for it to move ----
  // Starts at a random point so two instances behind one load balancer never hold the same number by accident.
  let version = Math.floor(Math.random() * 2 ** 40);
  const waiting = new Set<() => void>();
  let due = false;
  /** Signal that data changed outside a tool call (cron, webhook, queue). Tool calls do this by themselves. */
  const write = () => {
    version++;
    // Viewers are woken after the caller has moved on, so a tool call never waits for their renders, and a burst of writes wakes them once.
    if (!due) { due = true; setTimeout(() => { due = false; [...waiting].forEach((w) => w()); }); }
  };

  const render = async (params: Params = {}, user = "local") => {
    const r = await o.view({ user, params });
    if (!isHtml(r)) throw new Error("view must return html`...`.");
    return `<p-f id="p-root">${r.__html}</p-f>`;
  };
  // Viewers asking for the same thing at the same moment share one render. Nothing is kept once it settles.
  const flight = new Map<string, Promise<{ h: string; html: string }>>();
  const shared = (user: string, params?: Params) => {
    const k = version + "\0" + user + "\0" + JSON.stringify(params);
    let p = flight.get(k);
    if (!p) flight.set(k, p = render(params, user).then((html) => ({ h: hash(html), html })).finally(() => flight.delete(k)));
    return p;
  };

  /** Render for a viewer. If they are up to date (`v`), wait for a change first; send HTML only if it differs from what they show (`h`). */
  async function sync(user: string, s: SyncState = {}, waitMs = 25_000, signal?: AbortSignal): Promise<SyncResult> {
    if (s.v === version && !signal?.aborted) await new Promise<void>((res) => {
      const done = () => { clearTimeout(t); waiting.delete(done); signal?.removeEventListener("abort", done); res(); };
      const t = setTimeout(done, waitMs);
      waiting.add(done);
      signal?.addEventListener("abort", done);
    });
    if (signal?.aborted) throw new Error("cancelled"); // the viewer left or asked again: don't render for nobody
    const v = version, { h, html } = await shared(user, s.params);
    return h === s.h ? { v, h } : { v, h, html };
  }

  const shell = () =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>` +
    `<body><script>${RUNTIME}</script></body></html>`;
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

  /** Attach to an McpServer, before registering tools on it. Safe to call once per server instance (e.g. one server per session). */
  function attach<S extends ServerLike>(server: S): S {
    if (calls.has(server)) throw new Error("ui.attach() was already called for this server.");
    const inner = server.server, set = inner.setRequestHandler.bind(inner);
    const readOnly = new Set<string>(), reg = server.registerTool.bind(server);
    let seen = false;
    // Tools annotated readOnlyHint change nothing, so their calls wake nobody. Noted at registration, and again from tools/list for other registration styles.
    server.registerTool = (name: string, cfg: any, ...rest: any[]) => { if (cfg?.annotations?.readOnlyHint) readOnly.add(name); return reg(name, cfg, ...rest); };

    // The one seam: every tools/call (agent or human, any registration style) passes through here, then viewers refresh.
    inner.setRequestHandler = (schema: unknown, h: ToolCall) => {
      const m = method(schema), next = h;
      seen = true;
      if (m === "tools/call") calls.set(server, (h = async (req, extra) => {
        const r = await next(req, extra);
        if (req.params.name !== SYNC && !readOnly.has(req.params.name)) write();
        return r;
      }));
      else if (m === "tools/list") h = async (req, extra) => {
        const r = await next(req, extra);
        for (const t of r.tools) {
          t.annotations?.readOnlyHint ? readOnly.add(t.name) : readOnly.delete(t.name);
          if (o.attachTo?.includes(t.name)) t._meta = { ...t._meta, ui: { ...t._meta?.ui, resourceUri: uri } };
        }
        return r;
      };
      return set(schema, h);
    };

    server.registerResource(`${o.name}-ui`, uri, { mimeType: MCP_APP_MIME, description: `${o.name} UI` }, async () => ({
      contents: [{ uri, mimeType: MCP_APP_MIME, text: shell() }],
    }));
    seen = false;
    server.registerTool(SYNC, {
      description: "UI: render, or wait for a change", _meta: { ui: { visibility: ["app"] } },
      inputSchema: { params: z.record(z.string(), z.any()).optional(), h: z.string().optional(), v: z.number().optional() },
    }, async (s: SyncState, extra: Extra) => ({ ...text("ok"), structuredContent: await sync(identify(extra), s, undefined, extra?.signal) }));
    if (!calls.has(server)) throw new Error(seen
      ? "This @modelcontextprotocol/sdk version is not supported: tools/call handler not recognised."
      : "ui.attach(server) must be called before any tool is registered on the server.");

    site?.listen().catch(() => {}); // a failure surfaces when a link is asked for
    if (tool) server.registerTool(tool, {
      description: w!.toolDescription ?? `Show the ${o.name} UI to the user in their web browser, so they can see and work with it themselves. ` +
        `Use it when the user wants to view, review or change things by hand. Sends a private, single-use link; no sign-in.`,
    }, async (extra: Extra) => {
      const r = await openInBrowser(extra, { server });
      return text(r.opened ? `Opened ${o.name} in the user's browser.`
        : r.declined ? "The user declined to open the browser."
        : `Share this private link with the user. It works once and expires in ${w!.linkTtl ?? 120} seconds: ${r.url}`);
    });

    return server;
  }

  const site = w ? createWeb({ name: o.name, css, runtime: WEB, sync }, w) : undefined;

  /** Mint a single-use web link for the user behind an MCP request. The browser session acts as that user:
   *  its tool calls carry the same authInfo and run on `server` (the attached McpServer handling this request), and it ends when that auth expires. */
  function link(extra: Extra, server: object) {
    const call = server && calls.get(server);
    if (!site || !call) throw new Error("ui.link(extra, server) needs web mode (not web: false) and the attached server.");
    // A browser session must not mint links: it could renew itself for ever, and prompt the user's host at will.
    if (extra?.[FROM_WEB]) throw new Error("Not available from the web UI.");
    const authInfo = extra?.authInfo;
    return site.link(identify(extra), (name, args) => call({ method: "tools/call", params: { name, arguments: args } }, {
      [FROM_WEB]: true,
      authInfo, requestId: crypto.randomUUID(), signal: new AbortController().signal,
      sendNotification: async () => {},
      sendRequest: async () => { throw new Error("Not available from the web UI."); },
    }), authInfo?.expiresAt && authInfo.expiresAt * 1000);
  }

  /** From inside a tool handler: ask the host to open the web UI for this user (URL elicitation), or get a link to show.
   *  `server` is the attached McpServer handling this request. */
  async function openInBrowser(extra: Extra, opts: { message?: string; server: ServerLike }) {
    await site?.listen();
    const url = link(extra, opts?.server);
    const s = opts.server.server;
    if (s?.getClientCapabilities?.()?.elicitation?.url) {
      const r = await s.elicitInput({ mode: "url", message: opts.message ?? `Open ${o.name} in your browser`, url, elicitationId: crypto.randomUUID() },
        { relatedRequestId: extra?.requestId });
      return { opened: r.action === "accept", declined: r.action !== "accept", url };
    }
    return { opened: false, declined: false, url };
  }

  return {
    attach,
    write,
    /** Render the view to an HTML string (tests, snapshots). */
    render,
    /** Standalone HTML document with styles and no runtime, for screenshots and design review. */
    async preview(params?: Params, opts: { user?: string; theme?: "light" | "dark" } = {}) {
      return `<!doctype html><html${opts.theme ? ` data-theme="${opts.theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${await render(params, opts.user)}</body></html>`;
    },
    sync,
    /** Web site (unless web: false): fetch handler, Node adapter, revoke(). */
    site,
    link,
    openInBrowser,
    /** The user id for an MCP request, as the view receives it. Use it in tool handlers so tools and view agree on who is asking. */
    identify,
    uri,
    shell,
  };
}

export type Ui = ReturnType<typeof defineUi>;
