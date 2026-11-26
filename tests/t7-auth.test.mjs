// The browser carries the agent's MCP auth and nothing else: real HTTP MCP servers with the SDK's own bearer auth,
// a test token verifier, an agent over HTTP, and a browser driving ui.site. A stateless endpoint (fetch gate,
// createMcpHandler) and one that keeps sessions, which is refused. Then auth that makes no authInfo.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer, createMcpHandler, requireBearerAuth, OAuthError, WebStandardStreamableHTTPServerTransport, isInitializeRequest } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import * as lib from "../dist/index.js";
const err = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };
const SECRET = "auth-test-secret-".repeat(3), O = "https://a.test";

// Tokens the verifier knows. Changing an entry is the authorization server revoking or narrowing a token.
const tokens = new Map();
const issue = (sub, scopes = ["notes"], ttl = 600) => { const t = "tok-" + sub + "-" + randomUUID(); tokens.set(t, { sub, scopes, exp: Math.floor(Date.now() / 1000) + ttl }); return t; };
const verified = (token) => {
  const e = tokens.get(token);
  return e && { token, clientId: "agent-app", scopes: e.scopes, expiresAt: e.exp, extra: { sub: e.sub } };
};

const listen = (handler) => new Promise((ok) => { const s = http.createServer(handler).listen(0, "127.0.0.1", () => ok(s)); });
// Node's request as a fetch Request, and a fetch Response back onto Node's response.
const toRequest = async (q) => {
  const chunks = []; for await (const c of q) chunks.push(c);
  return new Request(`http://${q.headers.host}${q.url}`, { method: q.method, headers: q.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
};
const send = async (r, res) => { r.writeHead(res.status, Object.fromEntries(res.headers)); r.end(Buffer.from(await res.arrayBuffer())); };

const v2 = async () => {
  const verifier = { verifyAccessToken: async (t) => verified(t) ?? (() => { throw new OAuthError("invalid_token", "unknown or revoked"); })() };
  /** The SDK's bearer gate in front of /mcp (stateless) and /mcp-s (sessions). */
  const serve = async (make, count) => {
    const gate = requireBearerAuth({ verifier, requiredScopes: ["notes"] }), handler = createMcpHandler(make), sessions = {};
    // The SDK's own pattern for a server that keeps sessions.
    const withSessions = async (req, authInfo) => {
      const sid = req.headers.get("mcp-session-id");
      let t = sid && sessions[sid];
      const body = req.method === "POST" ? await req.clone().json().catch(() => undefined) : undefined;
      if (!t && !sid && req.method === "POST" && isInitializeRequest(body)) {
        t = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: (id) => { sessions[id] = t; } });
        t.onclose = () => { delete sessions[t.sessionId]; };
        await make().connect(t);
      }
      if (!t) return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID provided" }, id: null }, { status: 400 });
      return t.handleRequest(req, { authInfo });
    };
    const srv = await listen(async (q, r) => {
      count(q);
      const req = await toRequest(q), a = await gate(req);
      await send(r, a instanceof Response ? a : q.url.startsWith("/mcp-s") ? await withSessions(req, a) : await handler.fetch(req, { authInfo: a }));
    });
    return { srv, sessions };
  };
  return { McpServer, lib, serve, authOf: (x) => x.http?.authInfo };
};

describe("server 2.4", () => {
  let S, defineUi, html, WEB_META, ui, srv, sessions, MCP, mkUi;
  const db = {}, seen = [];
  let hits = [];
  const count = (q) => hits.push(`${q.method} ${q.url.split("?")[0]}`);
  const make = () => {
    const s = ui.attach(new S.McpServer({ name: "a", version: "1" }));
    const sub = (x) => ui.identify(x);
    s.registerTool("mine", { description: "read", annotations: { readOnlyHint: true } }, async (x) => ({ content: [{ type: "text", text: (db[sub(x)] ?? []).join() || "none" }] }));
    s.registerTool("add", { description: "write" }, async (x) => { seen.push(S.authOf(x)); (db[sub(x)] ??= []).push("n"); return { content: [{ type: "text", text: "added" }] }; });
    s.registerTool("admin", { description: "needs the admin scope" }, async (x) => S.authOf(x)?.scopes.includes("admin")
      ? { content: [{ type: "text", text: "ok" }] } : { content: [{ type: "text", text: "needs the admin scope" }], isError: true });
    // An integrator's own tool that hands out a link: from a browser it must refuse too.
    s.registerTool("share", { description: "link" }, async (x) => ({ content: [{ type: "text", text: await ui.link(x) }] }));
    return s;
  };
  const agent = async (token) => {
    const c = new Client({ name: "agent", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(MCP + "/mcp"), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return c;
  };
  const text = (r) => r.content?.[0]?.text ?? "";
  const ck = "__Host-p_a_ui";
  const open = async (token) => {
    const link = text(await (await agent(token)).callTool({ name: "open_a_in_browser", arguments: {} })).match(/https:\S+/)?.[0];
    const r = await ui.site.fetch(new Request(link, { method: "POST", headers: { "sec-fetch-site": "same-origin" } }));
    return { link, r, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  };
  const browser = (cookie) => ({
    page: () => ui.site.fetch(new Request(`${O}/ui/`, { headers: { cookie } })),
    sync: (body = {}) => ui.site.fetch(new Request(`${O}/ui/sync`, { method: "POST", headers: { cookie, "P-Req": "1" }, body: JSON.stringify(body) })),
    tool: (n, body = {}) => ui.site.fetch(new Request(`${O}/ui/tool/${n}`, { method: "POST", headers: { cookie, "P-Req": "1" }, body: JSON.stringify(body) })),
  });

  beforeAll(async () => {
    S = await v2(); ({ defineUi, html, WEB_META } = S.lib);
    ({ srv, sessions } = await S.serve(make, count)); MCP = `http://127.0.0.1:${srv.address().port}`;
    mkUi = (path) => defineUi({ name: "a", web: { origin: O, secret: SECRET, mcp: MCP + path }, view: async ({ user, call }) => html`<p>${user}: ${(await call("mine")).content[0].text}</p>` });
    ui = mkUi("/mcp");
  });
  afterAll(() => { srv?.closeAllConnections(); srv?.close(); });

  // (a) the page and clicks run as the token's user
  let ta, A, a, b;
  test("the agent's open tool, over authenticated HTTP, hands out a link that redeems", async () => {
    ta = issue("alice"); const tb = issue("bob");
    A = await open(ta); const B = await open(tb); a = browser(A.cookie); b = browser(B.cookie);
    expect(A.link).toMatch(/^https:\/\/a\.test\/ui\/l\//);
    expect(A.r.status).toBe(303);
  });
  test("a click runs as the token's user", async () => {
    seen.length = 0;
    expect((await a.tool("add")).status).toBe(200);
    expect((db.alice ?? []).join()).toBe("n");
    expect(db.bob).toBeUndefined();
  });
  test("the page renders as the token's user; two users never share one", async () => {
    expect(await (await a.page()).text()).toContain("alice: n");
    expect(await (await b.page()).text()).toContain("bob: none");
  });
  // (d) tools see the real token
  test("tools get the authInfo the server's own verifier made, with the real token", () => {
    expect(seen[0]?.token).toBe(ta);
    expect(seen[0].extra.sub).toBe("alice");
    expect(seen[0].clientId).toBe("agent-app");
  });

  // request count per check
  let s1;
  test("one browser check is one MCP request", async () => {
    hits = []; s1 = await (await a.sync({})).json();
    expect(s1.h).toBeTruthy();
    expect(hits).toEqual(["POST /mcp"]);
  });
  test("a click is one MCP request too", async () => {
    hits = []; await a.sync({ h: s1.h }); await a.tool("mine");
    expect(hits).toHaveLength(2);
  });

  // (f) cookie flags
  test("cookie flags", () => {
    expect(A.r.headers.get("set-cookie")).toMatch(new RegExp(`^${ck}=[\\w-]+; Path=/; HttpOnly; SameSite=Strict; Max-Age=\\d+; Secure$`));
  });
  test("Max-Age is the token's remaining life when shorter than sessionTtl", () => {
    const age = +/Max-Age=(\d+)/.exec(A.r.headers.get("set-cookie"))[1];
    expect(age).toBeLessThanOrEqual(600);
    expect(age).toBeGreaterThanOrEqual(595);
  });
  test("HSTS on the https origin", () => {
    expect(A.r.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });
  test("...and sessionTtl when the token lives longer", async () => {
    const L = await open(issue("lena", ["notes"], 7200));
    expect(Math.abs(+/Max-Age=(\d+)/.exec(L.r.headers.get("set-cookie"))[1] - 3600)).toBeLessThanOrEqual(1);
  });

  // (b) revocation: the very next sync and click fail, no grace
  let rs, rt, rp;
  test("token revoked: the very next sync is 401 (the page reloads)", async () => {
    hits = [];
    tokens.delete(ta);
    rs = await a.sync({}); rt = await a.tool("add"); rp = await a.page();
    expect(rs.status).toBe(401);
    expect((await rs.json()).error).toBe("unauthorized");
  });
  test("...and the very next click is 401, and does not run", () => {
    expect(rt.status).toBe(401);
    expect(db.alice.join()).toBe("n");
  });
  test("...and the reload shows the ask-the-assistant gate", async () => {
    expect(rp.status).toBe(401);
    expect(await rp.text()).toMatch(/Ask the assistant/);
  });
  test("each was refused by the server, not by a check of projector's own", () => {
    expect(hits).toHaveLength(3);
  });
  test("another user's browser is unaffected", async () => {
    expect((await b.sync({})).status).toBe(200);
  });

  // (c) scope: the server's own checks, at its door and in a tool
  let tc, C;
  test("a tool's own scope check refuses the browser as it refuses the agent", async () => {
    tc = issue("carol"); C = browser((await open(tc)).cookie);
    const adm = await C.tool("admin");
    expect(adm.status).toBe(400);
    expect((await adm.json()).error).toMatch(/admin scope/);
  });
  test("a token without the endpoint's required scope (403 there) is refused: 401 to the browser", async () => {
    tokens.get(tc).scopes = [];
    expect((await C.sync({})).status).toBe(401);
    expect((await C.tool("mine")).status).toBe(401);
  });
  test("...and works again once the server accepts it: projector keeps nothing of its own", async () => {
    tokens.get(tc).scopes = ["notes"];
    expect((await C.sync({})).status).toBe(200);
  });
  test("an expired token is refused by the server's check", async () => {
    tokens.get(tc).exp = Math.floor(Date.now() / 1000) - 1;
    expect((await C.sync({})).status).toBe(401);
  });

  // (e) the browser cannot mint links, through any tool
  let Dc, D, ag;
  test("the open tool refuses a browser call", async () => {
    const td = issue("dave"); Dc = (await open(td)).cookie; D = browser(Dc); ag = await agent(td);
    const o1 = await D.tool("open_a_in_browser"), t1 = await o1.text();
    expect(o1.status).toBe(400);
    expect(t1).toMatch(/Not available/);
    expect(t1).not.toMatch(/\/ui\/l\//);
  });
  test("an integrator's tool that calls ui.link refuses a browser call too", async () => {
    const o2 = await D.tool("share"), t2 = await o2.text();
    expect(o2.status).toBe(400);
    expect(t2).toMatch(/Not available/);
    expect(t2).not.toMatch(/\/ui\/l\//);
  });
  test("the same tool works for the agent", async () => {
    expect(text(await ag.callTool({ name: "share", arguments: {} }))).toMatch(/\/ui\/l\//);
  });
  test("a client that marks its own request as projector's only refuses itself", async () => {
    const marked = await ag.callTool({ name: "share", arguments: {}, _meta: { [WEB_META]: 1 } });
    expect(marked.isError).toBe(true);
    expect(text(marked)).toMatch(/Not available/);
  });
  test("p_sync is not a /ui/tool/ route", async () => {
    expect((await D.tool("p_sync")).status).toBe(404);
  });

  // (g) tampered and replayed links, tampered cookies
  let link;
  const redeem = (u) => ui.site.fetch(new Request(u, { method: "POST", headers: { "sec-fetch-site": "same-origin" } })).then((r) => r.status);
  const flip = (s, i) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
  test("a tampered link is refused", async () => {
    link = text(await (await agent(issue("erin"))).callTool({ name: "open_a_in_browser", arguments: {} })).match(/https:\S+/)[0];
    expect(await redeem(flip(link, link.length - 10))).toBe(410);
  });
  test("a link redeems once; a replay is refused", async () => {
    expect(await redeem(link)).toBe(303);
    expect(await redeem(link)).toBe(410);
  });
  test("a tampered cookie is refused", async () => {
    expect((await browser(flip(Dc, Dc.length - 10)).page()).status).toBe(401);
  });
  test("a link is not a cookie", async () => {
    expect((await browser(`${ck}=${link.split("/l/")[1]}`).page()).status).toBe(401);
  });

  // a hosted origin needs web.mcp
  test("web.origin without web.mcp: a clear error at defineUi", async () => {
    expect(await err(() => defineUi({ name: "bare", web: { origin: O, secret: SECRET }, view: () => html`x` }))).toMatch(/Set web\.mcp/);
  });

  // a server that keeps sessions is not supported: its 400 is an error, and no session is opened
  {
    let fr, ft;
    test("a web.mcp that keeps sessions: browser requests fail (500), and nothing runs", async () => {
      ui = mkUi("/mcp-s");
      const F = browser((await open(issue("fay"))).cookie);
      hits = []; fr = await F.sync({}); ft = await F.tool("add");
      expect(fr.status).toBe(500);
      expect(ft.status).toBe(500);
      expect(db.fay).toBeUndefined();
    });
    test("...at one request each, and no session is opened", () => {
      expect(hits).toEqual(["POST /mcp-s", "POST /mcp-s"]);
      expect(Object.keys(sessions)).toEqual([]);
    });
  }
});

// Auth that makes no authInfo (an API-key header, an IP allowlist): a link from such a request has no token, so a hosted
// origin must send the browser through the server's own endpoint, where that same check runs on every call.
describe("no authInfo", () => {
  const { defineUi, html } = lib;
  let ui, srv, M, byIp;
  const view = () => html`<p>ok</p>`;
  let deletes = 0;
  const keys = new Set(["key-1"]), ips = new Set(["127.0.0.1", "::ffff:127.0.0.1"]);
  const make = () => {
    const s = ui.attach(new McpServer({ name: "k", version: "1" }));
    s.registerTool("delete_all", { description: "admin" }, async () => { deletes++; return { content: [{ type: "text", text: "deleted" }] }; });
    return s;
  };
  const run = async (path, headers) => {
    ui = defineUi({ name: "k", web: { origin: O, secret: SECRET, mcp: M + path }, view });
    const c = new Client({ name: "agent", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(M + path), { requestInit: { headers } }));
    const link = (await c.callTool({ name: "open_k_in_browser", arguments: {} })).content[0].text.match(/https:\S+/)[0];
    const cookie = (await ui.site.fetch(new Request(link, { method: "POST" }))).headers.get("set-cookie").split(";")[0];
    return () => ui.site.fetch(new Request(`${O}/ui/tool/delete_all`, { method: "POST", headers: { cookie, "P-Req": "1" }, body: "{}" })).then((r) => r.status);
  };
  beforeAll(async () => {
    const handler = createMcpHandler(make);
    const gates = { "/key": (q) => keys.has(q.headers["x-api-key"]), "/ip": (q) => ips.has(q.socket.remoteAddress) };
    srv = await listen(async (q, r) => {
      const gate = gates[q.url.split("?")[0]];
      if (!gate || !gate(q)) { q.resume(); return r.writeHead(gate ? 401 : 404).end(); }
      await send(r, await handler.fetch(await toRequest(q)));
    });
    M = `http://127.0.0.1:${srv.address().port}`;
  });
  afterAll(() => { srv?.closeAllConnections(); srv?.close(); });

  test("web.origin without web.mcp is refused at defineUi: no in-process path past the server's auth", async () => {
    expect(await err(() => defineUi({ name: "k", web: { origin: O, secret: SECRET }, view }))).toMatch(/Set web\.mcp/);
  });
  test("an API-key server: the browser's call goes through the key check, carries no key, and is refused (fails closed)", async () => {
    const byKey = await run("/key", { "x-api-key": "key-1" });
    expect(await byKey()).toBe(401);
    expect(deletes).toBe(0);
  });
  test("an IP-allowlist server: the browser's call goes through the allowlist and runs", async () => {
    byIp = await run("/ip", {});
    expect(await byIp()).toBe(200);
    expect(deletes).toBe(1);
  });
  test("...and once the allowlist drops it, the very next call is refused and does not run", async () => {
    ips.clear();
    expect(await byIp()).toBe(401);
    expect(deletes).toBe(1);
  });
});
