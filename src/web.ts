// Web mode: same fragments on a normal URL, gated by single-use links that only the MCP server can mint.
// Standard fetch handler (Request → Response): works with Node (via toNode), Bun, Deno, Hono, Next route handlers.
import { createHash, randomBytes } from "node:crypto";
import type { Engine } from "./engine.js";

export type WebOptions = {
  /** Public origin, e.g. "https://app.example.com" or "http://localhost:3000". */
  origin: string;
  /** Mount path. Default "/ui". */
  base?: string;
  /** Seconds a link stays redeemable. Default 120. */
  linkTtl?: number;
  /** Seconds a browser session lasts. Default 3600. */
  sessionTtl?: number;
};
type Deps = { engine: Engine<any>; root: string; css: string; runtime: string; readOnly: boolean; name: string; call: (name: string, args: unknown, user: string) => unknown };
type Grant = { user: string; readOnly: boolean; exp: number };

const id = () => randomBytes(24).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest();

export function createWeb(d: Deps) {
  return (opts: WebOptions) => {
    const base = (opts.base ?? "/ui").replace(/\/$/, "");
    const linkTtl = (opts.linkTtl ?? 120) * 1000, sessionTtl = (opts.sessionTtl ?? 3600) * 1000;
    const secure = opts.origin.startsWith("https:");
    const links = new Map<string, Grant>();     // sha256(token) hex → grant (tokens are never stored)
    const sessions = new Map<string, Grant>();  // sha256(sid) hex → grant
    const assetTag = createHash("sha256").update(d.css + d.runtime).digest("hex").slice(0, 10);
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

    const session = (req: Request) => {
      const m = /(?:^|;\s*)p_s=([\w-]+)/.exec(req.headers.get("cookie") ?? "");
      const g = m && sessions.get(hash(m[1]).toString("hex"));
      return g && g.exp > Date.now() ? g : undefined;
    };

    async function fetch(req: Request): Promise<Response | null> {
      const url = new URL(req.url);
      if (url.pathname !== base && !url.pathname.startsWith(base + "/")) return null;
      const path = url.pathname.slice(base.length) || "/";

      // static, immutable assets
      if (req.method === "GET" && path === `/a/${assetTag}.css`) return new Response(d.css, { headers: { "Content-Type": "text/css", "Cache-Control": "public, max-age=31536000, immutable" } });
      if (req.method === "GET" && path === `/a/${assetTag}.js`) return new Response(d.runtime, { headers: { "Content-Type": "text/javascript", "Cache-Control": "public, max-age=31536000, immutable" } });

      // one-time link: GET shows a Continue page (link unfurlers can't burn it), POST redeems it
      const lm = /^\/l\/([\w-]+)$/.exec(path);
      if (lm) {
        const k = hash(lm[1]).toString("hex");
        const g = links.get(k);
        if (!g || g.exp < Date.now()) return page("Link expired", `<main class="gate"><h1>This link has expired</h1><p>Ask the assistant for a new one.</p></main>`, 410);
        if (req.method === "GET") return page(`Open ${d.name}`, `<main class="gate"><h1>Open ${d.name}</h1><p>You were sent a private link. It works once.</p><form method="post"><button class="btn">Continue</button></form></main>`);
        if (req.method !== "POST") return res(null, 405);
        links.delete(k);
        const sid = id();
        sessions.set(hash(sid).toString("hex"), { ...g, exp: Date.now() + sessionTtl });
        return res(null, 303, { Location: `${base}/`, "Set-Cookie": `p_s=${sid}; Path=${base}; HttpOnly; SameSite=Lax; Max-Age=${sessionTtl / 1000}${secure ? "; Secure" : ""}` });
      }

      const g = session(req);
      if (!g) return path === "/" ? page("Sign-in needed", `<main class="gate"><h1>No active session</h1><p>Ask the assistant to open this for you.</p></main>`, 401) : json({ error: "unauthorized" }, 401);
      const api = path !== "/";
      if (api && req.headers.get("P-Req") !== "1") return json({ error: "missing P-Req header" }, 403); // blocks cross-site simple requests

      if (path === "/" && req.method === "GET") {
        const m = await d.engine.mount(g.user, d.root);
        const state = JSON.stringify({ pid: m.pid, since: m.since, base }).replace(/</g, "\\u003c");
        return page(d.name, `${m.html}<script type="application/json" id="p-state">${state}</script><script src="${base}/a/${assetTag}.js"></script>`);
      }

      if (path === "/stream" && req.method === "GET") {
        const pid = url.searchParams.get("pid")!, since = +(url.searchParams.get("since") ?? 0);
        if (d.engine.userOf(pid) !== g.user) return json({ error: "unknown client" }, 410);
        let off = () => {}, beat: any;
        const enc = new TextEncoder();
        return new Response(new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(": open\n\n"));
            off = d.engine.subscribe(pid, since, g.user, (p) => c.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`)));
            beat = setInterval(() => c.enqueue(enc.encode(": ping\n\n")), 20_000);
          },
          cancel() { off(); clearInterval(beat); },
        }), { headers: { ...sec, "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" } });
      }

      const tm = /^\/tool\/([\w.-]+)$/.exec(path);
      if (tm && req.method === "POST") {
        if (d.readOnly || g.readOnly) return json({ error: "read-only" }, 403);
        const body = await req.json().catch(() => ({}));
        try {
          return json(await d.engine.call(body._pid, body._since ?? 0, g.user, async () => d.call(tm[1], body.args ?? {}, g.user)));
        } catch (e: any) { return json({ error: e.message }, 400); }
      }
      return json({ error: "not found" }, 404);
    }

    return {
      fetch,
      /** Node http adapter: http.createServer((req, res) => site.node(req, res, next?)). */
      async node(req: any, res: any, next?: () => void) {
        const chunks: Buffer[] = [];
        if (req.method !== "GET" && req.method !== "HEAD") for await (const c of req) chunks.push(c);
        const r = await fetch(new Request(new URL(req.url, opts.origin), {
          method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
        }));
        if (!r) return next ? next() : (res.statusCode = 404, res.end());
        res.writeHead(r.status, Object.fromEntries(r.headers));
        if (!r.body) return res.end();
        const rd = r.body.getReader();
        req.on("close", () => rd.cancel().catch(() => {}));
        for (;;) { const { value, done } = await rd.read(); if (done) break; res.write(value); }
        res.end();
      },
      /** Mint a single-use link for a user. Only call from trusted server code (e.g. inside a tool handler). */
      link(user: string, o: { readOnly?: boolean } = {}) {
        const t = id();
        links.set(hash(t).toString("hex"), { user, readOnly: !!(o.readOnly || d.readOnly), exp: Date.now() + linkTtl });
        return `${opts.origin}${base}/l/${t}`;
      },
      /** End every link and browser session for a user (e.g. when their MCP session ends). */
      revoke(user: string) { for (const m of [links, sessions]) for (const [k, g] of m) if (g.user === user) m.delete(k); },
      close: () => clearInterval(sweep),
    };
  };
}
