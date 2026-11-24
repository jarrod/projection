// Web mode: the same view on a normal URL. There is no sign-in: a browser session is delegated from an MCP request
// through a single-use link, and acts as that MCP user. Standard fetch handler (Request → Response), plus a Node adapter.
import { createHash, randomBytes } from "node:crypto";
import { brotliCompress, gzip, constants as zc } from "node:zlib";
import { promisify } from "node:util";
const br = promisify(brotliCompress), gz = promisify(gzip);
import type { SyncState, SyncResult } from "./ui.js";

export type WebOptions = {
  /** Public origin, e.g. "https://app.example.com" or "http://localhost:3000". */
  origin: string;
  /** Mount path. Default "/ui". */
  base?: string;
  /** Seconds a link stays redeemable. Default 120. */
  linkTtl?: number;
  /** Seconds a browser session lasts (never longer than the MCP auth it came from). Default 3600. */
  sessionTtl?: number;
};
type Deps = { name: string; css: string; runtime: string; sync: (user: string, s?: SyncState, waitMs?: number, signal?: AbortSignal) => Promise<SyncResult> };
const MAX_BODY = 1_000_000; // bytes the Node adapter will buffer for one request
type Call = (name: string, args: unknown) => Promise<any>;
type Grant = { user: string; call: Call; exp: number; until: number };

const id = () => randomBytes(24).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export function createWeb(d: Deps, opts: WebOptions) {
  const base = (opts.base ?? "/ui").replace(/\/$/, "");
  const linkTtl = (opts.linkTtl ?? 120) * 1000, sessionTtl = (opts.sessionTtl ?? 3600) * 1000;
  const secure = opts.origin.startsWith("https:");
  const links = new Map<string, Grant>();     // sha256(token) → grant (tokens are never stored)
  const sessions = new Map<string, Grant>();  // sha256(sid) → grant
  const assetTag = hash(d.css + d.runtime).slice(0, 10);
  const sweep = setInterval(() => { const n = Date.now(); for (const m of [links, sessions]) for (const [k, g] of m) if (g.exp < n) m.delete(k); }, 60_000);
  (sweep as any).unref?.();

  const sec = {
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
  };
  const res = (body: BodyInit | null, status = 200, h: Record<string, string> = {}) => new Response(body, { status, headers: { ...sec, ...h } });
  const page = (title: string, body: string, status = 200) =>
    res(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="${base}/a/${assetTag}.css"></head><body>${body}</body></html>`, status, { "Content-Type": "text/html; charset=utf-8" });
  const json = (o: unknown, status = 200) => res(JSON.stringify(o), status, { "Content-Type": "application/json" });
  const asset = (body: string, type: string) => new Response(body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" } });

  const session = (req: Request) => {
    const m = /(?:^|;\s*)p_s=([\w-]+)/.exec(req.headers.get("cookie") ?? "");
    const g = m && sessions.get(hash(m[1]));
    return g && g.exp > Date.now() ? g : undefined;
  };

  const owns = (pathname: string) => pathname === base || pathname.startsWith(base + "/");

  async function fetch(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (!owns(url.pathname)) return null;
    const path = url.pathname.slice(base.length) || "/";

    if (req.method === "GET" && path === `/a/${assetTag}.css`) return asset(d.css, "text/css");
    if (req.method === "GET" && path === `/a/${assetTag}.js`) return asset(d.runtime, "text/javascript");

    // one-time link: GET shows a Continue page (link unfurlers can't burn it), POST redeems it
    const lm = /^\/l\/([\w-]+)$/.exec(path);
    if (lm) {
      const k = hash(lm[1]);
      const g = links.get(k);
      if (!g || g.exp < Date.now()) return page("Link expired", `<main class="gate"><h1>This link has expired</h1><p>Ask the assistant for a new one.</p></main>`, 410);
      if (req.method === "GET") return page(`Open ${d.name}`, `<main class="gate"><h1>Open ${d.name}</h1><p>You were sent a private link. It works once.</p><form method="post"><button class="btn">Continue</button></form></main>`);
      if (req.method !== "POST") return res(null, 405);
      links.delete(k);
      const sid = id(), exp = Math.min(Date.now() + sessionTtl, g.until);
      sessions.set(hash(sid), { ...g, exp });
      return res(null, 303, { Location: `${base}/`, "Set-Cookie": `p_s=${sid}; Path=${base}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((exp - Date.now()) / 1000)}${secure ? "; Secure" : ""}` });
    }

    const g = session(req);
    if (!g) return path === "/" ? page("No active session", `<main class="gate"><h1>No active session</h1><p>Ask the assistant to open this for you.</p></main>`, 401) : json({ error: "unauthorized" }, 401);

    if (path === "/" && req.method === "GET") {
      let s: SyncResult;
      try { s = await d.sync(g.user); }
      catch { return res(null, 500); }
      const state = JSON.stringify({ v: s.v, h: s.h, base }).replace(/</g, "\\u003c");
      return page(d.name, `${s.html}<script type="application/json" id="p-state">${state}</script><script src="${base}/a/${assetTag}.js"></script>`);
    }

    if (req.method !== "POST") return json({ error: "not found" }, 404);
    if (req.headers.get("P-Req") !== "1") return json({ error: "missing P-Req header" }, 403); // blocks cross-site simple requests
    const body = await req.json().catch(() => ({}));
    try {
      if (path === "/sync") return json(await d.sync(g.user, body ?? {}, undefined, req.signal));
      const tm = /^\/tool\/([\w.-]+)$/.exec(path);
      if (!tm) return json({ error: "not found" }, 404);
      const r = await g.call(tm[1], body);
      return r?.isError ? json({ error: r.content?.[0]?.text ?? "tool error" }, 400) : json(r);
    } catch (e: any) { return json({ error: e.message }, 400); }
  }

  return {
    fetch,
    /** Node http adapter: http.createServer((req, res) => site.node(req, res, next?)). Compresses with brotli or gzip.
     *  `fetch` leaves compression to the platform (Cloudflare, Deno Deploy and most CDNs do it). */
    async node(req: any, res: any, next?: () => void) {
      // Requests outside the mount path are passed on untouched: their body is not read here.
      let pathname = "";
      try { pathname = new URL(req.url, opts.origin).pathname; } catch {}
      if (!owns(pathname)) return next ? next() : (res.statusCode = 404, res.end());
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        if (req.method !== "GET" && req.method !== "HEAD") for await (const c of req) {
          if ((size += c.length) > MAX_BODY) { res.writeHead(413, { Connection: "close" }); return res.end(); }
          chunks.push(c);
        }
        // A viewer that goes away (closed tab, superseded poll) releases its held sync at once.
        const gone = new AbortController();
        res.on("close", () => gone.abort());
        const r = await fetch(new Request(new URL(req.url, opts.origin), {
          method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined, signal: gone.signal,
        }));
        if (!r) return next ? next() : (res.statusCode = 404, res.end());
        const h = Object.fromEntries(r.headers), ae = String(req.headers["accept-encoding"] ?? "");
        let body: Buffer = Buffer.from(await r.arrayBuffer());
        const enc = body.length < 1024 ? "" : /\bbr\b/.test(ae) ? "br" : /\bgzip\b/.test(ae) ? "gzip" : "";
        if (enc) { body = await (enc === "br" ? br(body, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } }) : gz(body)); h["content-encoding"] = enc; h.vary = "Accept-Encoding"; }
        res.writeHead(r.status, h);
        res.end(body);
      } catch {
        // Never let a bad request (unsupported method, malformed header) or a failed render reject: that would end the process.
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    },
    /** Mint a single-use link. Use ui.link(extra), which binds it to the MCP request's user, auth and server. */
    link(user: string, call: Call, until?: number) {
      const t = id();
      links.set(hash(t), { user, call, exp: Date.now() + linkTtl, until: until || Infinity });
      return `${opts.origin}${base}/l/${t}`;
    },
    /** End every link and browser session for a user (e.g. when their MCP session ends). */
    revoke(user: string) { for (const m of [links, sessions]) for (const [k, g] of m) if (g.user === user) m.delete(k); },
    close: () => clearInterval(sweep),
  };
}
