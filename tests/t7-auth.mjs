// The browser carries the agent's MCP auth and nothing else: real HTTP MCP servers with the SDK's own bearer auth,
// a test token verifier, an agent over HTTP, and a browser driving ui.site. SDK v1 (Express middleware, stateless, and a
// server that keeps sessions, which is refused) and v2 (fetch gate, createMcpHandler). Then auth that makes no authInfo.
import http from "node:http";
import { cpSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
const ROOT = new URL("..", import.meta.url).pathname, HERE = join(ROOT, "tests/node_modules");
const SDK1 = join(ROOT, "examples/notes-server/node_modules/@modelcontextprotocol/sdk/dist/esm"), NM1 = join(ROOT, "examples/notes-server/node_modules");
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const err = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };
const SECRET = "auth-test-secret-".repeat(3), O = "https://a.test";

const { Client } = await import(join(SDK1, "client/index.js"));
const { StreamableHTTPClientTransport } = await import(join(SDK1, "client/streamableHttp.js"));

// Tokens the verifier knows. Changing an entry is the authorization server revoking or narrowing a token.
const tokens = new Map();
const issue = (sub, scopes = ["notes"], ttl = 600) => { const t = "tok-" + sub + "-" + randomUUID(); tokens.set(t, { sub, scopes, exp: Math.floor(Date.now() / 1000) + ttl }); return t; };
const verified = (token) => {
  const e = tokens.get(token);
  return e && { token, clientId: "agent-app", scopes: e.scopes, expiresAt: e.exp, extra: { sub: e.sub } };
};

const listen = (handler) => new Promise((ok) => { const s = http.createServer(handler).listen(0, "127.0.0.1", () => ok(s)); });

const v1 = async () => {
  const { McpServer } = await import(join(SDK1, "server/mcp.js"));
  const { StreamableHTTPServerTransport } = await import(join(SDK1, "server/streamableHttp.js"));
  const { requireBearerAuth } = await import(join(SDK1, "server/auth/middleware/bearerAuth.js"));
  const { InvalidTokenError } = await import(join(SDK1, "server/auth/errors.js"));
  const { isInitializeRequest } = await import(join(SDK1, "types.js"));
  const express = (await import(join(NM1, "express/index.js"))).default;
  const lib = await import(join(ROOT, "dist/index.js"));
  const verifier = { verifyAccessToken: async (t) => verified(t) ?? (() => { throw new InvalidTokenError("unknown or revoked"); })() };
  /** An Express app with the SDK's bearer middleware in front of /mcp (stateless) and /mcp-s (sessions). */
  const serve = async (make, count) => {
    const app = express(), auth = requireBearerAuth({ verifier, requiredScopes: ["notes"] }), sessions = {};
    app.use((q, _r, next) => { count(q); next(); });
    app.post("/mcp", express.json(), auth, async (req, res) => {
      const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => t.close());
      await make().connect(t);
      await t.handleRequest(req, res, req.body);
    });
    // The SDK's own pattern for a server that keeps sessions.
    app.all("/mcp-s", express.json(), auth, async (req, res) => {
      const sid = req.headers["mcp-session-id"];
      let t = sid && sessions[sid];
      if (!t && !sid && req.method === "POST" && isInitializeRequest(req.body)) {
        t = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: (id) => { sessions[id] = t; } });
        t.onclose = () => { delete sessions[t.sessionId]; };
        await make().connect(t);
      }
      if (!t) return res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID provided" }, id: null });
      await t.handleRequest(req, res, req.body);
    });
    return { srv: await listen(app), sessions };
  };
  return { McpServer, lib, serve, authOf: (x) => x.authInfo, sessions: true };
};

const v2 = async () => {
  // A copy of the library in a project with v2 only, as in t4.
  const dir = mkdtempSync(join(tmpdir(), "projector-auth-v2-")), mods = join(dir, "node_modules");
  mkdirSync(join(mods, "@modelcontextprotocol"), { recursive: true });
  cpSync(join(ROOT, "dist"), join(dir, "dist"), { recursive: true });
  cpSync(join(ROOT, "package.json"), join(dir, "package.json"));
  symlinkSync(join(HERE, "@modelcontextprotocol/server"), join(mods, "@modelcontextprotocol/server"));
  symlinkSync(join(HERE, "zod"), join(mods, "zod"));
  const require = createRequire(join(dir, "dist/x.js"));
  const { McpServer, createMcpHandler, requireBearerAuth, OAuthError } = await import(join(dirname(require.resolve("@modelcontextprotocol/server")), "index.mjs"));
  const lib = await import(join(dir, "dist/index.js"));
  const verifier = { verifyAccessToken: async (t) => verified(t) ?? (() => { throw new OAuthError("invalid_token", "unknown or revoked"); })() };
  const serve = async (make, count) => {
    const gate = requireBearerAuth({ verifier, requiredScopes: ["notes"] }), handler = createMcpHandler(make);
    const srv = await listen(async (q, r) => {
      count(q);
      const chunks = []; for await (const c of q) chunks.push(c);
      const req = new Request(`http://${q.headers.host}${q.url}`, { method: q.method, headers: q.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const a = await gate(req), res = a instanceof Response ? a : await handler.fetch(req, { authInfo: a });
      r.writeHead(res.status, Object.fromEntries(res.headers)); r.end(Buffer.from(await res.arrayBuffer()));
    });
    return { srv };
  };
  return { McpServer, lib, serve, authOf: (x) => x.http?.authInfo };
};

for (const [label, setup] of [["sdk v1", v1], ["server 2.4", v2]]) {
  const S = await setup(), { defineUi, html, WEB_META } = S.lib, pass = (c, m) => ok(c, `[${label}] ${m}`);
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
  let ui;
  const { srv, sessions } = await S.serve(make, count), MCP = `http://127.0.0.1:${srv.address().port}`;
  const mkUi = (path) => defineUi({ name: "a", web: { origin: O, secret: SECRET, mcp: MCP + path }, view: async ({ user, call }) => html`<p>${user}: ${(await call("mine")).content[0].text}</p>` });
  ui = mkUi("/mcp");

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

  // (a) the page and clicks run as the token's user
  const ta = issue("alice"), tb = issue("bob");
  const A = await open(ta), B = await open(tb), a = browser(A.cookie), b = browser(B.cookie);
  pass(/^https:\/\/a\.test\/ui\/l\//.test(A.link) && A.r.status === 303, "the agent's open tool, over authenticated HTTP, hands out a link that redeems");
  seen.length = 0;
  pass((await a.tool("add")).status === 200 && (db.alice ?? []).join() === "n" && !db.bob, "a click runs as the token's user");
  pass((await (await a.page()).text()).includes("alice: n") && (await (await b.page()).text()).includes("bob: none"), "the page renders as the token's user; two users never share one");
  // (d) tools see the real token
  pass(seen[0]?.token === ta && seen[0].extra.sub === "alice" && seen[0].clientId === "agent-app", "tools get the authInfo the server's own verifier made, with the real token");

  // request count per check
  hits = []; const s1 = await (await a.sync({})).json();
  pass(s1.h && hits.join() === "POST /mcp", `one browser check is one MCP request (${hits.join(", ")})`);
  hits = []; await a.sync({ h: s1.h }); await a.tool("mine");
  pass(hits.length === 2, "a click is one MCP request too");

  // (f) cookie flags
  const sc = A.r.headers.get("set-cookie"), age = +/Max-Age=(\d+)/.exec(sc)[1];
  pass(new RegExp(`^${ck}=[\\w-]+; Path=/; HttpOnly; SameSite=Strict; Max-Age=\\d+; Secure$`).test(sc), `cookie: ${sc.replace(/=[\w-]{20,}/, "=…")}`);
  pass(age <= 600 && age >= 595, `Max-Age is the token's remaining life when shorter than sessionTtl (${age} s)`);
  pass(A.r.headers.get("strict-transport-security") === "max-age=31536000", "HSTS on the https origin");
  const tl = issue("lena", ["notes"], 7200), L = await open(tl);
  pass(Math.abs(+/Max-Age=(\d+)/.exec(L.r.headers.get("set-cookie"))[1] - 3600) <= 1, "...and sessionTtl when the token lives longer");

  // (b) revocation: the very next sync and click fail, no grace
  hits = [];
  tokens.delete(ta);
  const rs = await a.sync({}), rt = await a.tool("add"), rp = await a.page();
  pass(rs.status === 401 && (await rs.json()).error === "unauthorized", "token revoked: the very next sync is 401 (the page reloads)");
  pass(rt.status === 401 && db.alice.join() === "n", "...and the very next click is 401, and does not run");
  pass(rp.status === 401 && /Ask the assistant/.test(await rp.text()), "...and the reload shows the ask-the-assistant gate");
  pass(hits.length === 3, "each was refused by the server, not by a check of projector's own");
  pass((await b.sync({})).status === 200, "another user's browser is unaffected");

  // (c) scope: the server's own checks, at its door and in a tool
  const tc = issue("carol"), C = browser((await open(tc)).cookie);
  const adm = await C.tool("admin");
  pass(adm.status === 400 && /admin scope/.test((await adm.json()).error), "a tool's own scope check refuses the browser as it refuses the agent");
  tokens.get(tc).scopes = [];
  pass((await C.sync({})).status === 401 && (await C.tool("mine")).status === 401, "a token without the endpoint's required scope (403 there) is refused: 401 to the browser");
  tokens.get(tc).scopes = ["notes"];
  pass((await C.sync({})).status === 200, "...and works again once the server accepts it: projector keeps nothing of its own");
  tokens.get(tc).exp = Math.floor(Date.now() / 1000) - 1;
  pass((await C.sync({})).status === 401, "an expired token is refused by the server's check");

  // (e) the browser cannot mint links, through any tool
  const td = issue("dave"), Dc = (await open(td)).cookie, D = browser(Dc), ag = await agent(td);
  const o1 = await D.tool("open_a_in_browser"), o2 = await D.tool("share");
  const t1 = await o1.text(), t2 = await o2.text();
  pass(o1.status === 400 && /Not available/.test(t1) && !/\/ui\/l\//.test(t1), "the open tool refuses a browser call");
  pass(o2.status === 400 && /Not available/.test(t2) && !/\/ui\/l\//.test(t2), "an integrator's tool that calls ui.link refuses a browser call too");
  pass(/\/ui\/l\//.test(text(await ag.callTool({ name: "share", arguments: {} }))), "the same tool works for the agent");
  const marked = await ag.callTool({ name: "share", arguments: {}, _meta: { [WEB_META]: 1 } });
  pass(marked.isError && /Not available/.test(text(marked)), "a client that marks its own request as projector's only refuses itself");
  pass((await D.tool("p_sync")).status === 404, "p_sync is not a /ui/tool/ route");

  // (g) tampered and replayed links, tampered cookies
  const te = issue("erin"), link = text(await (await agent(te)).callTool({ name: "open_a_in_browser", arguments: {} })).match(/https:\S+/)[0];
  const redeem = (u) => ui.site.fetch(new Request(u, { method: "POST", headers: { "sec-fetch-site": "same-origin" } })).then((r) => r.status);
  const flip = (s, i) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
  pass(await redeem(flip(link, link.length - 10)) === 410, "a tampered link is refused");
  pass(await redeem(link) === 303 && await redeem(link) === 410, "a link redeems once; a replay is refused");
  pass((await browser(flip(Dc, Dc.length - 10)).page()).status === 401, "a tampered cookie is refused");
  pass((await browser(`${ck}=${link.split("/l/")[1]}`).page()).status === 401, "a link is not a cookie");

  // a hosted origin needs web.mcp
  pass(/Set web\.mcp/.test(await err(() => defineUi({ name: "bare", web: { origin: O, secret: SECRET }, view: () => html`x` }))), "web.origin without web.mcp: a clear error at defineUi");

  // a server that keeps sessions is not supported: its 400 is an error, and no session is opened
  if (S.sessions) {
    ui = mkUi("/mcp-s");
    const tf = issue("fay"), F = browser((await open(tf)).cookie);
    hits = []; const fr = await F.sync({}), ft = await F.tool("add");
    pass(fr.status === 500 && ft.status === 500 && !db.fay, "a web.mcp that keeps sessions: browser requests fail (500), and nothing runs");
    pass(hits.join() === "POST /mcp-s,POST /mcp-s" && !Object.keys(sessions).length, `...at one request each, and no session is opened (${hits.join(", ")})`);
  }
  srv.closeAllConnections(); srv.close();
}

// Auth that makes no authInfo (an API-key header, an IP allowlist): a link from such a request has no token, so a hosted
// origin must send the browser through the server's own endpoint, where that same check runs on every call.
{
  const { McpServer } = await import(join(SDK1, "server/mcp.js"));
  const { StreamableHTTPServerTransport } = await import(join(SDK1, "server/streamableHttp.js"));
  const express = (await import(join(NM1, "express/index.js"))).default;
  const { defineUi, html } = await import(join(ROOT, "dist/index.js"));
  const view = () => html`<p>ok</p>`;
  let ui;
  ok(/Set web\.mcp/.test(await err(() => defineUi({ name: "k", web: { origin: O, secret: SECRET }, view }))), "[no authInfo] web.origin without web.mcp is refused at defineUi: no in-process path past the server's auth");
  let deletes = 0;
  const keys = new Set(["key-1"]), ips = new Set(["127.0.0.1", "::ffff:127.0.0.1"]);
  const make = () => {
    const s = ui.attach(new McpServer({ name: "k", version: "1" }));
    s.registerTool("delete_all", { description: "admin" }, async () => { deletes++; return { content: [{ type: "text", text: "deleted" }] }; });
    return s;
  };
  const app = express();
  const mount = (path, gate) => app.post(path, express.json(), (q, r, next) => gate(q) ? next() : r.status(401).end(), async (q, r) => {
    const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); r.on("close", () => t.close());
    await make().connect(t); await t.handleRequest(q, r, q.body);
  });
  mount("/key", (q) => keys.has(q.headers["x-api-key"]));
  mount("/ip", (q) => ips.has(q.socket.remoteAddress));
  const srv = await listen(app), M = `http://127.0.0.1:${srv.address().port}`;
  const run = async (path, headers) => {
    ui = defineUi({ name: "k", web: { origin: O, secret: SECRET, mcp: M + path }, view });
    const c = new Client({ name: "agent", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(M + path), { requestInit: { headers } }));
    const link = (await c.callTool({ name: "open_k_in_browser", arguments: {} })).content[0].text.match(/https:\S+/)[0];
    const cookie = (await ui.site.fetch(new Request(link, { method: "POST" }))).headers.get("set-cookie").split(";")[0];
    return () => ui.site.fetch(new Request(`${O}/ui/tool/delete_all`, { method: "POST", headers: { cookie, "P-Req": "1" }, body: "{}" })).then((r) => r.status);
  };
  const byKey = await run("/key", { "x-api-key": "key-1" });
  ok(await byKey() === 401 && deletes === 0, "[no authInfo] an API-key server: the browser's call goes through the key check, carries no key, and is refused (fails closed)");
  const byIp = await run("/ip", {});
  ok(await byIp() === 200 && deletes === 1, "[no authInfo] an IP-allowlist server: the browser's call goes through the allowlist and runs");
  ips.clear();
  ok(await byIp() === 401 && deletes === 1, "[no authInfo] ...and once the allowlist drops it, the very next call is refused and does not run");
  srv.closeAllConnections(); srv.close();
}

console.log(fails ? `\n${fails} FAILED` : "\nall auth checks passed");
process.exit(fails ? 1 : 0);
