// defineUi: the one entry point. Bolts a human UI onto an existing McpServer without touching agent-facing tools.
import { z } from "zod";
import { createEngine, type Loaders, type FragmentFn, type Params } from "./engine.js";
import { RUNTIME, RUNTIME_RO, WEB, WEB_RO, CSS } from "./assets.js";
import { createWeb, type WebOptions } from "./web.js";

export const MCP_APP_MIME = "text/html;profile=mcp-app";

export type UiOptions<L extends Loaders> = {
  /** Short name, used for the default resource URI ui://<name>/app.html. */
  name: string;
  /** Data the UI can read. Fragments subscribe to the keys they read. */
  load: L;
  /** Tools whose calls change data → the keys they change. Agent AND UI calls refresh the screen.
   *  Unless readOnly, these are also the only tools the UI may call. */
  writes?: Record<string, (keyof L & string)[]>;
  /** Existing tools whose results should open the UI in MCP Apps hosts (adds _meta.ui.resourceUri). */
  attachTo?: string[];
  /** No actions from the UI. Ships a smaller runtime and registers no p_call. */
  readOnly?: boolean;
  /** Root fragment. Default "app". */
  root?: string;
  /** Extra CSS appended after the kit. */
  css?: string;
  /** Skip the built-in kit CSS entirely. */
  bare?: boolean;
  /** Map an MCP request to a stable user id. Default: authInfo.extra.sub → authInfo.clientId → "local". */
  identify?: (extra: any) => string;
  /** Override the ui:// URI. */
  uri?: string;
  /** Dev lints (unknown hx-tool, missing tools). Default: NODE_ENV !== "production". */
  dev?: boolean;
  /** Also serve the UI on a normal URL, gated by single-use links. Serve it with ui.site.fetch / ui.site.node. */
  web?: WebOptions & {
    /** Register a model-visible tool with this name that opens the UI in the user's browser (URL elicitation, link fallback). */
    tool?: string;
    toolDescription?: string;
  };
};

type Handler = (args: any, extra: any) => unknown;
type ServerLike = { registerTool: (...a: any[]) => any; registerResource: (...a: any[]) => any; server?: any };

export function defineUi<const L extends Loaders>(o: UiOptions<L>) {
  const uri = o.uri ?? `ui://${o.name}/app.html`;
  const root = o.root ?? "app";
  const writes = o.writes ?? {};
  const dev = o.dev ?? (typeof process !== "undefined" && process.env?.NODE_ENV !== "production");
  const identify = o.identify ?? ((extra: any) => extra?.authInfo?.extra?.sub ?? extra?.authInfo?.clientId ?? "local");
  const css = (o.bare ? "" : CSS) + (o.css ?? "");
  const runtime = o.readOnly ? RUNTIME_RO : RUNTIME;
  const byServer = new WeakMap<object, Map<string, Handler>>();
  let latest: Map<string, Handler> = new Map(); // used by web mode (no MCP request in scope)
  const warned = new Set<string>();
  const warn = (k: string, msg: string) => { if (!warned.has(k)) { warned.add(k); console.warn(`[mcp-projection] ${msg}`); } };
  let attached = false;

  const engine = createEngine<L>({
    load: o.load,
    onRender: dev ? (name, body) => {
      for (const m of body.matchAll(/hx-tool="([^"]+)"/g)) {
        const t = m[1];
        if (o.readOnly) warn(`ro:${name}`, `Fragment "${name}" uses hx-tool="${t}" but the UI is readOnly; the click will do nothing.`);
        else if (!(t in writes)) warn(`tool:${t}`, `Fragment "${name}" uses hx-tool="${t}", but "${t}" is not in defineUi({ writes }). Add writes: { ${t}: [/* keys it changes */] }.`);
        else if (attached && !latest.has(t)) warn(`missing:${t}`, `Tool "${t}" was never registered after ui.attach(). Call ui.attach(server) BEFORE server.registerTool(...).`);
      }
    } : undefined,
  });

  const shell = () =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>` +
    `<body data-p-root="${root}"><script>${runtime}</script></body></html>`;

  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  const ok = (structuredContent: object) => ({ ...text("ok"), structuredContent });
  const fail = (t: string) => ({ ...text(t), isError: true });

  /** Run a captured tool handler exactly as the agent would, for a UI client. */
  async function proxy(handlers: Map<string, Handler>, name: string, args: unknown, extra: any) {
    const h = handlers.get(name);
    if (!h) throw new Error(name in writes
      ? `Tool "${name}" is in writes but was not registered after ui.attach().`
      : `UI may not call "${name}". Add it to defineUi({ writes }).`);
    return h(args ?? {}, extra);
  }

  /** Attach to an McpServer. Safe to call once per server instance (e.g. one server per session). */
  function attach<S extends ServerLike>(server: S): S {
    if (byServer.has(server)) throw new Error("ui.attach() was already called for this server.");
    const handlers = new Map<string, Handler>();
    byServer.set(server, handlers);
    latest = handlers;
    attached = true;
    const register = server.registerTool.bind(server);

    // Wrap tools registered from now on: same config (plus optional _meta.ui.resourceUri), same result, refresh UI after.
    (server as any).registerTool = (name: string, config: any, handler: (...a: any[]) => any) => {
      const keys = writes[name];
      const wrapped = keys ? async (...a: any[]) => { const r = await handler(...a); await engine.write(...keys); return r; } : handler;
      if (keys) handlers.set(name, wrapped);
      const cfg = o.attachTo?.includes(name) ? { ...config, _meta: { ...config?._meta, ui: { ...config?._meta?.ui, resourceUri: uri } } } : config;
      return register(name, cfg, wrapped);
    };

    server.registerResource(`${o.name}-ui`, uri, { mimeType: MCP_APP_MIME, description: `${o.name} UI` }, async () => ({
      contents: [{ uri, mimeType: MCP_APP_MIME, text: shell() }],
    }));

    const appOnly = { ui: { visibility: ["app"] } };
    register("p_mount", { description: "UI: initial render", inputSchema: { root: z.string().optional() }, _meta: appOnly },
      async ({ root: r }: { root?: string }, extra: any) => ok(await engine.mount(identify(extra), r ?? root)));
    register("p_sync", { description: "UI: wait for updates", inputSchema: { _pid: z.string(), _since: z.number() }, _meta: appOnly },
      async ({ _pid, _since }: any, extra: any) => {
        try { return ok({ patches: await engine.sync(_pid, _since, identify(extra)) }); } catch (e: any) { return fail(e.message); }
      });
    if (!o.readOnly) register("p_call", {
      description: "UI: call an allowed tool", _meta: appOnly,
      inputSchema: { tool: z.string(), args: z.record(z.string(), z.any()).optional(), _pid: z.string(), _since: z.number() },
    }, async ({ tool, args, _pid, _since }: any, extra: any) => {
      try { return ok(await engine.call(_pid, _since, identify(extra), () => proxy(handlers, tool, args, extra) as Promise<unknown>)); }
      catch (e: any) { return fail(e.message); }
    });

    if (o.web?.tool) register(o.web.tool, {
      description: o.web.toolDescription ?? `Open the ${o.name} UI in the user's web browser with a private, single-use link.`,
      inputSchema: { readOnly: z.boolean().optional().describe("Open without the ability to make changes") },
    }, async ({ readOnly }: { readOnly?: boolean }, extra: any) => {
      const r = await openInBrowser(extra, { readOnly, server });
      return text(r.opened ? `Opened ${o.name} in the user's browser.`
        : r.declined ? "The user declined to open the browser."
        : `Share this private link with the user. It works once and expires in ${o.web!.linkTtl ?? 120} seconds: ${r.url}`);
    });

    queueMicrotask(() => setTimeout(() => {
      if (!dev) return;
      for (const t of Object.keys(writes)) if (!handlers.has(t)) warn(`missing:${t}`, `writes lists "${t}" but no tool "${t}" was registered after ui.attach().`);
    }, 0));
    return server;
  }

  const web = createWeb({
    engine, root, css, runtime: o.readOnly ? WEB_RO : WEB, readOnly: !!o.readOnly, name: o.name,
    call: (name, args, user) => proxy(latest, name, args, { authInfo: { extra: { sub: user } }, ui: "web" }),
  });

  const site = o.web ? web(o.web) : undefined;

  async function openInBrowser(extra: any, opts: { message?: string; readOnly?: boolean; server?: ServerLike } = {}) {
    if (!site) throw new Error("openInBrowser needs defineUi({ web: { origin } }).");
    const url = site.link(identify(extra), { readOnly: opts.readOnly });
    const s = opts.server?.server;
    if (s?.getClientCapabilities?.()?.elicitation?.url) {
      const r = await s.elicitInput({ mode: "url", message: opts.message ?? `Open ${o.name} in your browser`, url, elicitationId: crypto.randomUUID() },
        { relatedRequestId: extra?.requestId });
      return { opened: r.action === "accept", declined: r.action !== "accept", url };
    }
    return { opened: false, declined: false, url };
  }

  return {
    /** Attach to an McpServer. Call BEFORE registering tools so their handlers can be captured. */
    attach,
    /** Define a fragment: (ctx) => html. It re-renders when any key it read is written. */
    fragment(name: string, fn: FragmentFn<L>) { engine.fragment(name, fn); return this; },
    /** Signal a data change from outside tools (cron, webhooks, queues). */
    write: (...keys: (keyof L & string | `${keyof L & string}:${string}`)[]) => engine.write(...keys),
    /** Render a fragment to an HTML string (tests, snapshots). */
    render: (name = root, opts: { user?: string; params?: Params } = {}) => engine.renderOnce(opts.user ?? "local", name, opts.params),
    /** Standalone HTML document with styles and no runtime, for screenshots and design review. */
    async preview(name = root, opts: { user?: string; params?: Params; theme?: "light" | "dark" } = {}) {
      const body = await engine.renderOnce(opts.user ?? "local", name, opts.params);
      return `<!doctype html><html${opts.theme ? ` data-theme="${opts.theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
    },
    /** Web site (when defineUi({ web }) is set): fetch handler, Node adapter, link(), revoke(). */
    site,
    /** From inside a tool handler: ask the host to open the web UI for this user (URL elicitation), or get a link to show.
     *  Pass { server } (your McpServer) to enable elicitation. */
    openInBrowser,
    uri,
    shell,
    engine,
  };
}

export type Ui = ReturnType<typeof defineUi>;
