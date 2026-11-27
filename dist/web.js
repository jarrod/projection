// Web mode: the same view on a normal URL. There is no sign-in: a single-use link hands the browser the bearer token of
// the MCP request that minted it, and every browser request is an MCP request with that token, to the server's own
// endpoint. Projector keeps no identity of its own. Standard fetch handler (Request → Response), plus a Node adapter.
import { esc } from "./html.js";
const MAX_BODY = 1_000_000; // bytes the Node adapter will buffer for one request
const MAX_TOKEN = 3800;
const TIMEOUT = 30_000; // ms a browser request waits for web.mcp // a browser drops a cookie over about 4096 bytes without saying so; this leaves room for its name and attributes
// Web Crypto only: nothing here may need Node built-ins or run at import time (Cloudflare workerd without nodejs_compat).
const enc = (s) => new TextEncoder().encode(s);
const UNAUTH = new Error("unauthorized");
/** In the `_meta` of every tools/call projector sends for a browser. Only ever makes a request refuse to mint a link,
 *  so a client that sets it harms nobody but itself. */
export const WEB_META = "mcp-projector/web";
export function createWeb(d, opts) {
    const base = (opts.base ?? "/ui").replace(/\/$/, "");
    const linkTtl = (opts.linkTtl ?? 120) * 1000, sessionTtl = (opts.sessionTtl ?? 3600) * 1000;
    let origin = opts.origin ?? "", host = "", up, srv;
    const assetTag = d.tag, name = esc(d.name), secret = opts.secret, mcp = opts.mcp;
    if ((origin || secret != null) && !(typeof secret === "string" && secret.length >= 32))
        throw new Error("web.secret must be at least 32 random characters, the same on every instance (required with web.origin).");
    // The cookie carries a bearer token: Secure and __Host- (no subdomain can set or shadow it), except on plain http to this machine.
    let bare;
    try {
        bare = new URL(origin).origin === origin;
    }
    catch { }
    if (origin && !(bare && /^(https:|http:\/\/(localhost|127\.[\d.]+|\[::1\])(:\d+)?$)/.test(origin)))
        throw new Error(`web.origin must be https (http only on localhost), and an origin only, like "https://app.example.com": no path, query or trailing slash.`);
    // Without web.mcp a browser's calls run in this process, past whatever auth guards the server's endpoint: only the self-started local listener may.
    if (origin && !mcp)
        throw new Error("Set web.mcp with web.origin: every browser request must reach the server through its own MCP endpoint and auth.");
    const secure = () => origin.startsWith("https:");
    // Cookies ignore the port: on plain http to this machine the name carries it, so two local servers keep apart.
    const ck = () => (secure() ? "__Host-" : "") + ("p_" + d.name + base + (secure() ? "" : origin.match(/:\d+$/) ?? "")).replace(/\W/g, "_");
    // The key itself is kept, never the promise of one: on Workers a promise belongs to the request that made it.
    let key, rnd;
    const aes = async () => key ??= await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", secret ? enc("mcp-projector " + secret) : rnd ??= crypto.getRandomValues(new Uint8Array(32))), "AES-GCM", false, ["encrypt", "decrypt"]);
    // Bound to its kind and this app: a link is not a cookie, and another app's token does not open here, even with the same secret.
    const gcm = (kind, iv) => ({ name: "AES-GCM", iv, additionalData: enc(JSON.stringify([kind, d.name, origin, base])) });
    const seal = async (kind, g) => {
        const iv = crypto.getRandomValues(new Uint8Array(12)), c = new Uint8Array(await crypto.subtle.encrypt(gcm(kind, iv), await aes(), enc(JSON.stringify(g))));
        return btoa(String.fromCharCode(...iv, ...c)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    };
    /** What the token holds, or nothing if it was not sealed here as this kind. The caller checks exp. */
    const open = async (kind, t) => {
        if (t.length <= MAX_TOKEN)
            try {
                const b = Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
                return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(gcm(kind, b.slice(0, 12)), await aes(), b.slice(12))));
            }
            catch { }
    };
    // Default claim: link ids seen by this process, forgotten once their link has expired.
    const used = new Map();
    const claim = opts.claim ?? ((id, exp) => {
        const n = Date.now();
        for (const [k, e] of used)
            if (e < n)
                used.delete(k);
        return !used.has(id) && !!used.set(id, exp);
    });
    const sec = {
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
    };
    const res = (body, status = 200, h = {}) => new Response(body, { status, headers: { ...sec, ...(secure() ? { "Strict-Transport-Security": "max-age=31536000" } : {}), ...h } });
    const page = (title, body, status = 200) => res(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="${base}/a/${assetTag}.css"></head><body>${body}</body></html>`, status, { "Content-Type": "text/html; charset=utf-8" });
    const expired = () => page("Link expired", `<main class="gate"><h1>This link has expired</h1><p>Ask the assistant for a new one.</p></main>`, 410);
    const json = (o, status = 200) => res(JSON.stringify(o), status, { "Content-Type": "application/json" });
    const asset = (body, type) => new Response(body, { headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=31536000, immutable" } });
    const session = async (req) => {
        // Every cookie of our name is tried (a few): a stale one must not hide the real one. Two valid ones mean one was
        // planted, and we can't tell which: then neither counts.
        let found;
        for (const m of [...(req.headers.get("cookie") ?? "").matchAll(new RegExp(`(?:^|;\\s*)${ck()}=([\\w-]+)`, "g"))].slice(0, 4)) {
            const g = await open("session", m[1]);
            if (g && g.exp > Date.now()) {
                if (found)
                    return;
                found = g;
            }
        }
        return found;
    };
    const owns = (pathname) => pathname === base || pathname.startsWith(base + "/");
    /** One tools/call for a browser, as one MCP request to web.mcp with its token (no Authorization without one), ended
     *  with the browser's request or after TIMEOUT. A refused token (401, 403) throws UNAUTH; any other non-2xx, an error. */
    async function call(t, tool, args, s) {
        if (!mcp)
            return d.local(tool, args);
        const h = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
        if (t)
            h.Authorization = "Bearer " + t;
        const signal = AbortSignal.any ? AbortSignal.any([s, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT);
        // A redirect is not followed (and, not being 2xx, is an error): the bearer token is never sent on to another URL.
        // "manual", not "error", which Workers refuse.
        const q = new Request(new URL(typeof mcp === "string" ? mcp : "/mcp", origin), { method: "POST", headers: h, signal, redirect: "manual",
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args, _meta: { [WEB_META]: 1 } } }) });
        return Promise.race([new Promise((_, no) => signal.addEventListener("abort", () => no(signal.reason))), (async () => {
                const r = await (typeof mcp === "string" ? globalThis.fetch(q) : mcp(q));
                if (r.status === 401 || r.status === 403)
                    throw UNAUTH;
                if (!r.ok)
                    throw new Error("web.mcp answered " + r.status);
                const b = await r.text(), m = /event-stream/.test(r.headers.get("content-type") ?? "")
                    ? b.split("\n").map((l) => { if (l.startsWith("data:"))
                        try {
                            return JSON.parse(l.slice(5));
                        }
                        catch { } }).find((m) => m?.id === 1 && !m.method) : JSON.parse(b);
                if (!m || m.error)
                    throw new Error(m?.error?.message ?? "no response");
                return m.result;
            })()]);
    }
    /** The view for this browser: p_sync through the server, which renders it for the user the token belongs to. */
    const sync = async (t, a, s) => {
        const r = await call(t, "p_sync", a, s);
        if (!r?.structuredContent || r.isError)
            throw new Error();
        return r.structuredContent;
    };
    async function fetch(req) {
        const url = new URL(req.url);
        if (!owns(url.pathname))
            return null;
        const path = url.pathname.slice(base.length) || "/";
        if (req.method === "GET" && path === `/a/${assetTag}.css`)
            return asset(d.css, "text/css");
        if (req.method === "GET" && path === `/a/${assetTag}.js`)
            return asset(d.runtime, "text/javascript");
        // one-time link: GET shows a Continue page (link unfurlers can't burn it), POST redeems it
        const lm = /^\/l\/([\w-]+)$/.exec(path);
        if (lm) {
            const g = await open("link", lm[1]);
            if (!g || g.exp < Date.now())
                return expired();
            if (req.method === "GET")
                return page(`Open ${name}`, `<main class="gate"><h1>Open ${name}</h1><p>You were sent a private link. It works once.</p><form method="post"><button class="btn">Continue</button></form></main>`);
            if (req.method !== "POST")
                return res(null, 405);
            // Only our own Continue page may redeem: another site must not sign this browser in to someone else's session.
            const site = req.headers.get("sec-fetch-site"), from = req.headers.get("origin");
            if (site ? site !== "same-origin" : from && from !== origin)
                return res(null, 403);
            let first;
            try {
                first = await claim(g.id, g.exp);
            }
            catch {
                return res(null, 500);
            }
            if (first !== true)
                return expired();
            const exp = Math.min(Date.now() + sessionTtl, g.until ?? Infinity);
            return res(null, 303, { Location: `${base}/`, "Set-Cookie": `${ck()}=${await seal("session", { t: g.t, exp })}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor((exp - Date.now()) / 1000)}${secure() ? "; Secure" : ""}` });
        }
        const g = await session(req);
        const out = path === "/" && req.method === "GET"
            ? () => page("No active session", `<main class="gate"><h1>No active session</h1><p>Ask the assistant to open this for you.</p></main>`, 401)
            : () => json({ error: "unauthorized" }, 401);
        if (!g)
            return out();
        if (path === "/" && req.method === "GET") {
            let s;
            try {
                s = await sync(g.t, {}, req.signal);
            }
            catch (e) {
                return e === UNAUTH ? out() : res(null, 500);
            }
            return page(name, `${s.html}${d.state({ h: s.h, base })}<script src="${base}/a/${assetTag}.js"></script>`);
        }
        if (req.method !== "POST")
            return json({ error: "not found" }, 404);
        if (req.headers.get("P-Req") !== "1")
            return json({ error: "missing P-Req header" }, 403); // blocks cross-site simple requests
        // The Node adapter caps bodies as it reads them; on other hosts check here, before parsing.
        if (+(req.headers.get("content-length") ?? 0) > MAX_BODY)
            return json({ error: "too large" }, 413);
        const raw = await req.text();
        if (raw.length > MAX_BODY)
            return json({ error: "too large" }, 413);
        let body = {};
        try {
            body = JSON.parse(raw);
        }
        catch { }
        try {
            if (path === "/sync") {
                // Same shape the MCP path validates: params is an object or nothing.
                const p = body?.params;
                return json(await sync(g.t, { h: typeof body?.h === "string" ? body.h : undefined, params: p && typeof p === "object" && !Array.isArray(p) ? p : {} }, req.signal));
            }
            const tm = /^\/tool\/([\w.-]+)$/.exec(path);
            if (!tm || tm[1] === "p_sync")
                return json({ error: "not found" }, 404); // sync has its own route
            const r = await call(g.t, tm[1], body, req.signal);
            return r?.isError ? json({ error: r.content?.[0]?.text ?? "tool error" }, 400) : json(r);
        }
        catch (e) {
            return e === UNAUTH ? out() : json({ error: "error" }, 500);
        } // a tool's own error text is returned above; internal failures are not described
    }
    /** Node http adapter: http.createServer((req, res) => site.node(req, res, next?)). Compresses with brotli or gzip.
     *  `fetch` leaves compression to the platform (Cloudflare, Deno Deploy and most CDNs do it). */
    async function node(req, res, next) {
        // Requests outside the mount path are passed on untouched: their body is not read here.
        let pathname = "";
        try {
            pathname = new URL(req.url, origin).pathname;
        }
        catch { }
        if (!owns(pathname))
            return next ? next() : (res.statusCode = 404, res.end());
        try {
            const chunks = [];
            let size = 0;
            if (req.method !== "GET" && req.method !== "HEAD")
                for await (const c of req) {
                    if ((size += c.length) > MAX_BODY) {
                        res.writeHead(413, { Connection: "close" });
                        return res.end();
                    }
                    chunks.push(c);
                }
            const ac = new AbortController(); // a browser that goes away ends its call to web.mcp
            res.on("close", () => ac.abort());
            const r = await fetch(new Request(new URL(req.url, origin), {
                method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined, signal: ac.signal,
            }));
            if (!r)
                return next ? next() : (res.statusCode = 404, res.end());
            const h = Object.fromEntries(r.headers), ae = String(req.headers["accept-encoding"] ?? "");
            let body = Buffer.from(await r.arrayBuffer());
            const enc = body.length < 1024 ? "" : /\bbr\b/.test(ae) ? "br" : /\bgzip\b/.test(ae) ? "gzip" : "";
            if (enc) {
                const z = await import("node:zlib"), b = body;
                body = await new Promise((ok, no) => (enc === "br" ? z.brotliCompress : z.gzip)(b, { params: { [z.constants.BROTLI_PARAM_QUALITY]: 5 } }, (e, o) => e ? no(e) : ok(o)));
                h["content-encoding"] = enc;
                h.vary = "Accept-Encoding";
            }
            res.writeHead(r.status, h);
            res.end(body);
        }
        catch {
            // Never let a bad request (unsupported method, malformed header) or a failed render reject: that would end the process.
            if (!res.headersSent)
                res.writeHead(500);
            res.end();
        }
    }
    return {
        fetch,
        node,
        /** Without an origin, start serving on 127.0.0.1 at a free port (once). The listener never keeps the process alive.
         *  It refuses requests naming another Host (DNS rebinding); a failed start is retried on the next call. */
        listen: () => up ??= origin ? Promise.resolve() : import("node:http").then((h) => new Promise((ok, fail) => {
            srv = h.createServer((q, r) => q.headers.host === host ? node(q, r) : (r.statusCode = 421, r.end())).on("error", fail);
            srv.listen(0, "127.0.0.1", () => { origin = `http://${host = `127.0.0.1:${srv.address().port}`}`; srv.unref(); ok(); });
        })).catch((e) => { up = undefined; throw e; }),
        /** Mint a single-use link that carries this authInfo's bearer token. Use ui.link(extra), which reads it from the MCP request. */
        async link(a) {
            if (!origin)
                throw new Error("The web UI is still starting.");
            if (a && !a.token)
                throw new Error("This request has authInfo but no bearer token (authInfo.token) to hand to the browser.");
            if (a && !mcp)
                throw new Error("Set web.mcp: a browser opened from an authenticated request calls the server's MCP endpoint with its token.");
            const until = a?.expiresAt ? a.expiresAt * 1000 : undefined;
            // The session cookie holds less than this, so it is no longer.
            const t = await seal("link", { id: crypto.randomUUID(), t: a?.token, exp: Math.min(Date.now() + linkTtl, until ?? Infinity), until });
            if (t.length > MAX_TOKEN)
                throw new Error(`The bearer token is too long for a browser cookie (${t.length} of ${MAX_TOKEN} bytes sealed).`);
            return `${origin}${base}/l/${t}`;
        },
        close: () => { srv?.close(); if (srv)
            origin = host = "", up = srv = undefined; },
    };
}
