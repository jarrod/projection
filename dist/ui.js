// defineUi: the one entry point. Bolts a human UI onto an existing McpServer without touching agent-facing tools.
// The server keeps no per-viewer state: a viewer sends its view params and the hash of what it shows, and gets HTML back if that differs.
import { z } from "zod";
import { RUNTIME, WEB, CSS } from "./assets.js";
import { createWeb, WEB_META } from "./web.js";
export { WEB_META };
import { isHtml } from "./html.js";
export const MCP_APP_MIME = "text/html;profile=mcp-app";
const SYNC = "p_sync";
const FROM_WEB = Symbol("web"); // marks the `extra` of a tool call projector makes in process (a view's read, a local browser call)
// Not a secret. Synchronous and without node: built-ins, so it also runs at import time on Workers.
const hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++)
        h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
};
const auth = (x) => x?.http?.authInfo;
// In the 2026-07-28 protocol every request carries its client's capabilities; before it they belong to the connection.
const caps = (x, inner) => x?.mcpReq?.envelope?.["io.modelcontextprotocol/clientCapabilities"] ?? inner.getClientCapabilities();
const no = () => { throw new Error("Not available from the web UI."); };
// Made for a browser or a view: in process (the symbol), or over MCP (the _meta projector's proxy sets).
const fromWeb = (x) => !!(x?.[FROM_WEB] || x?.mcpReq?._meta?.[WEB_META]);
const refuse = async () => no(), ignore = async () => { };
export function defineUi(o) {
    const uri = o.uri ?? `ui://${o.name}/app.html`;
    const identify = (extra) => {
        const a = auth(extra), user = String((o.identify ? o.identify(extra) : a ? a.extra?.sub : "local") ?? "");
        // No id means no user: never fall back to a shared one. A client id names the agent app, not the person using it.
        if (!user)
            throw new Error("No user id: set authInfo.extra.sub in your token verifier, or return one from defineUi({ identify }).");
        return user;
    };
    const css = (o.bare ? "" : CSS) + (o.css ?? "");
    if (/<\/style/i.test(css))
        throw new Error("css must not contain </style");
    const calls = new WeakMap();
    let latest, attached = 0; // the server attached most recently, and how many have been
    const readers = new WeakMap(); // per server: tools annotated readOnlyHint
    const reads = new Set(o.reads);
    const w = o.web ?? {};
    const tool = w && (w.tool ?? `open_${o.name.replace(/[^\w-]/g, "_")}_in_browser`);
    const poll = Math.max(1, o.poll ?? 5) * 1000; // ms between a page's checks
    const noReader = async () => { throw new Error("call needs a viewer: the view was rendered outside an MCP request or browser session."); };
    const render = async (params = {}, user = "local", call = noReader) => {
        const r = await o.view({ user, params, call });
        if (!isHtml(r))
            throw new Error("view must return html`...`.");
        return `<p-f id="p-root">${r.__html}</p-f>`;
    };
    /** One check from an open page: render now, and send the HTML only if it differs from what the page shows (`h`).
     *  Nothing is kept between checks, so any instance can answer any page. */
    async function sync(user, s = {}, call) {
        const html = await render(s.params, user, call), h = hash(html);
        return h === s.h ? { h } : { h, html };
    }
    const doc = (body, theme) => `<!doctype html><html${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
    const state = (s) => `<script type="application/json" id="p-state">${JSON.stringify({ ...s, poll }).replace(/</g, "\\u003c")}</script>`;
    const shell = () => doc(state({}) + `<script>${RUNTIME}</script>`);
    const text = (t) => ({ content: [{ type: "text", text: t }] });
    /** Attach to an McpServer, before registering tools on it. Safe to call once per server instance (e.g. one server per session). */
    function attach(server) {
        if (calls.has(server))
            throw new Error("ui.attach() was already called for this server.");
        const inner = server.server, set = inner.setRequestHandler.bind(inner);
        let seen = false; // the SDK registered a request handler through our hook
        const readOnly = new Set(), reg = server.registerTool.bind(server);
        // Tools annotated readOnlyHint change nothing, so a view may call them. Noted at registration, and again from tools/list for other registration styles.
        server.registerTool = (name, cfg, ...rest) => { if (cfg.annotations?.readOnlyHint)
            readOnly.add(name); return reg(name, cfg, ...rest); };
        // The one seam: the server's own tools/call handler is kept, so UI calls run exactly what agent calls run.
        // It is also registered as (method, schemas, handler), where the handler gets the params instead of the request.
        inner.setRequestHandler = (m, ...a) => {
            const next = a.pop();
            let h = next;
            seen = true;
            if (m === "tools/call")
                calls.set(server, (req, extra) => next(a[0] ? req.params : req, extra));
            if (m === "tools/list")
                h = async (req, extra) => {
                    const r = await next(req, extra);
                    // p_sync is for the UI runtime. A client without MCP Apps would show it to the model, so it is left out there (calls still work).
                    if (!caps(extra, inner)?.extensions?.["io.modelcontextprotocol/ui"])
                        r.tools = r.tools.filter((t) => t.name !== SYNC);
                    for (const t of r.tools) {
                        t.annotations?.readOnlyHint ? readOnly.add(t.name) : readOnly.delete(t.name);
                        if (o.attachTo?.includes(t.name))
                            t._meta = { ...t._meta, ui: { ...t._meta?.ui, resourceUri: uri } };
                    }
                    return r;
                };
            return set(m, ...a, h);
        };
        readers.set(server, readOnly);
        server.registerResource(`${o.name}-ui`, uri, { mimeType: MCP_APP_MIME, description: `${o.name} UI` }, async () => ({
            contents: [{ uri, mimeType: MCP_APP_MIME, text: shell() }],
        }));
        seen = false;
        server.registerTool(SYNC, {
            description: "UI: render the view if it changed", _meta: { ui: { visibility: ["app"] } },
            inputSchema: { params: z.record(z.string(), z.any()).optional(), h: z.string().optional() },
        }, async (s, extra) => ({ ...text("ok"), structuredContent: await sync(identify(extra), s, reader(server, extra)) }));
        if (!calls.has(server))
            throw new Error(seen
                ? "This MCP SDK version is not supported: tools/call handler not recognised."
                : "ui.attach(server) must be called before any tool is registered on the server.");
        latest = server;
        attached++;
        site?.listen().catch(ignore); // a failure surfaces when a link is asked for
        // Not annotated readOnlyHint: it hands out a sign-in link, so a host should ask the user before running it.
        if (w && tool)
            server.registerTool(tool, {
                description: w.toolDescription ?? `Show the ${o.name} UI to the user in their web browser, so they can see and work with it themselves. ` +
                    `Use it when the user wants to view, review or change things by hand. Sends a private, single-use link; no sign-in.`,
            }, async (extra) => {
                const r = await openInBrowser(extra, { server });
                return text(r.opened ? `Opened ${o.name} in the user's browser.`
                    : r.declined ? "The user declined to open the browser."
                        : `Share this private link with the user. It works once and expires in ${w.linkTtl ?? 120} seconds: ${r.url}`);
            });
        return server;
    }
    // A browser of the self-started local listener (no web.origin) without web.mcp: its calls run in this process.
    const site = w ? createWeb({ name: o.name, css, runtime: WEB, tag: hash(css + WEB), state, local(name, args) {
            // With one server per connection or request, the latest one belongs to someone else.
            if (attached > 1 || !latest)
                throw new Error(latest ? "Several servers are attached to this ui: set web.mcp." : "No server for browser calls: attach one, or set web.mcp.");
            return caller(latest)(name, args);
        } }, w) : undefined;
    /** Run a tool through the server's own tools/call handler, in process: inside the MCP request `x` (a view's read),
     *  or, with none, as a local browser call without auth. It can never ask the client anything, nor mint a link. */
    const caller = (server, x = {}) => async (name, args) => {
        const call = calls.get(server), id = crypto.randomUUID(), signal = x.mcpReq?.signal ?? new AbortController().signal, method = "tools/call";
        const r = await call({ method, params: { name, arguments: args } }, {
            ...x, [FROM_WEB]: true,
            mcpReq: { requestState: () => { }, notify: ignore, log: ignore, ...x.mcpReq, id, method, signal, send: refuse, elicitInput: refuse, requestSampling: refuse },
        });
        // The tool wants to ask the client something first, so it has not run.
        return r?.resultType === "input_required" ? no() : r;
    };
    /** What a view's `call` does: the same, for read tools only, so rendering a view can never change data. */
    const reader = (server, extra) => {
        const run = caller(server, extra);
        return async (name, args = {}) => {
            if (name === SYNC || name === tool || !(readers.get(server)?.has(name) || reads.has(name)))
                throw new Error(`The view can only call read tools: annotate ${name} with readOnlyHint, or add it to defineUi({ reads }).`);
            return run(name, args);
        };
    };
    /** Mint a single-use web link from an MCP request. The browser then sends that request's bearer token to web.mcp with
     *  every call, so the server checks it as it checks the agent's, and the browser is signed out once it stops working. */
    async function link(extra) {
        if (!site)
            throw new Error("ui.link needs web mode.");
        // A browser must not mint links: it could renew itself, and prompt the user's host at will.
        if (fromWeb(extra))
            no();
        identify(extra); // an authenticated request with no user is refused here too
        return site.link(auth(extra));
    }
    /** From inside a tool handler: ask the host to open the web UI for this user (URL elicitation), or get a link to show.
     *  `server` is the attached McpServer handling this request. */
    async function openInBrowser(extra, opts) {
        // Over the network with no origin set, a 127.0.0.1 link would only work on the server's own machine.
        const req = extra?.http?.req, host = req && (req.headers.get("host") ?? new URL(req.url).host);
        if (w && !w.origin && host && !/^(localhost|127(\.\d+){3}|\[::1\])(:\d+)?$/.test(host))
            throw new Error("Set web.origin: this user is remote.");
        await site?.listen();
        const s = opts?.server?.server;
        if (!s)
            throw new Error("ui.openInBrowser needs the attached server handling this request.");
        const url = await link(extra);
        let opened = false, declined = false;
        if (caps(extra, s)?.elicitation?.url)
            try {
                opened = (await s.elicitInput({ mode: "url", message: opts.message ?? `Open ${o.name} in your browser`, url, elicitationId: crypto.randomUUID() }, { relatedRequestId: extra?.mcpReq?.id })).action === "accept";
                declined = !opened;
            }
            catch { } // timed out, failed, or a protocol where a server cannot ask (2026-07-28): hand back the link instead
        return { opened, declined, url };
    }
    return {
        attach,
        /** Render the view to an HTML string (tests, snapshots). */
        render,
        /** Standalone HTML document with styles and no runtime, for screenshots and design review. */
        async preview(params, opts = {}) {
            return doc(await render(params, opts.user), opts.theme);
        },
        sync,
        /** Web site (unless web: false): fetch handler, Node adapter. */
        site,
        link,
        openInBrowser,
        /** The user id for an MCP request, as the view receives it. Use it in tool handlers so tools and view agree on who is asking. */
        identify,
        uri,
        shell,
    };
}
