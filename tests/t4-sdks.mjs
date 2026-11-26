// The same behaviour on every supported MCP SDK: v1, v2 on the 2025 protocol, v2 on the 2026-07-28 protocol (per-request server).
import { cpSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { z } from "zod";
const ROOT = new URL("..", import.meta.url).pathname, HERE = join(ROOT, "tests/node_modules");
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const err = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };
const APPS = { extensions: { "io.modelcontextprotocol/ui": {} } }, URLS = { elicitation: { url: {} } };
const textOf = (r) => r.content?.[0]?.text ?? "";
const linkIn = (r) => textOf(r).match(/http\S+/)?.[0];

// For v2, a copy of the library in a project that has v2 only: nothing on that path may need v1.
const v2Project = (server) => {
  const dir = mkdtempSync(join(tmpdir(), "projector-v2-")), mods = join(dir, "node_modules");
  mkdirSync(join(mods, "@modelcontextprotocol"), { recursive: true });
  cpSync(join(ROOT, "dist"), join(dir, "dist"), { recursive: true });
  cpSync(join(ROOT, "package.json"), join(dir, "package.json"));
  symlinkSync(join(HERE, server), join(mods, "@modelcontextprotocol/server"));
  symlinkSync(join(HERE, "@modelcontextprotocol/client"), join(mods, "@modelcontextprotocol/client"));
  symlinkSync(join(HERE, "zod"), join(mods, "zod"));
  return join(dir, "dist");
};
const load = async (dist) => ({ ...await import(join(dist, "index.js")), ...await import(join(dist, "testing.js")) });

const v1 = async () => {
  const sdk = join(ROOT, "examples/notes-server/node_modules/@modelcontextprotocol/sdk/dist/esm");
  const { McpServer } = await import(join(sdk, "server/mcp.js")), { Client } = await import(join(sdk, "client/index.js"));
  const { InMemoryTransport } = await import(join(sdk, "inMemory.js")), { ElicitRequestSchema } = await import(join(sdk, "types.js"));
  const { WebStandardStreamableHTTPServerTransport: T } = await import(join(sdk, "server/webStandardStreamableHttp.js"));
  // The server's MCP endpoint in process: stateless, given the authInfo its own bearer check found.
  const endpoint = (make, check) => async (req) => {
    const authInfo = check(req); if (!authInfo) return new Response(null, { status: 401 });
    const t = new T({ sessionIdGenerator: undefined, enableJsonResponse: true }); await make().connect(t);
    return t.handleRequest(req, { authInfo });
  };
  return { McpServer, endpoint, lib: await load(join(ROOT, "dist")), onElicit: (c, h) => c.setRequestHandler(ElicitRequestSchema, h),
    shape: (s) => s, connect: inMemory(Client, InMemoryTransport), req: (headers) => ({ requestInfo: { headers } }), auth: (authInfo) => ({ authInfo }) };
};
const inMemory = (Client, InMemoryTransport) => async (make, { capabilities = {}, authInfo, onElicit } = {}) => {
  const [a, b] = InMemoryTransport.createLinkedPair(), send = a.send.bind(a);
  a.send = (m, o) => send(m, { ...o, authInfo });
  await make().connect(b);
  const c = new Client({ name: "c", version: "1" }, { capabilities });
  onElicit?.(c);
  await c.connect(a);
  return c;
};
const v2 = (name, modern) => async () => {
  const dist = v2Project(name), require = createRequire(join(dist, "x.js"));
  const entry = (p) => join(dirname(require.resolve(p)), "index.mjs");
  const { McpServer, createMcpHandler, inputRequired } = await import(entry("@modelcontextprotocol/server"));
  const { Client, InMemoryTransport, StreamableHTTPClientTransport } = await import(entry("@modelcontextprotocol/client"));
  // A server per request, over HTTP, where each request carries its client's capabilities.
  const http = async (make, { capabilities = {}, authInfo, host = "localhost" } = {}) => {
    const handler = createMcpHandler(make), base = `http://${host}/mcp`;
    const c = new Client({ name: "c", version: "1" }, { capabilities, versionNegotiation: { mode: { pin: "2026-07-28" } } });
    await c.connect(new StreamableHTTPClientTransport(new URL(base), { fetch: (u, i) => handler.fetch(new Request(u, i), { authInfo }) }));
    return c;
  };
  const endpoint = (make, check) => async (req) => {
    const authInfo = check(req); if (!authInfo) return new Response(null, { status: 401 });
    return createMcpHandler(make).fetch(req, { authInfo });
  };
  return { McpServer, endpoint, inputRequired, lib: await load(dist), modern, onElicit: (c, h) => c.setRequestHandler("elicitation/create", h), shape: (s) => z.object(s),
    connect: modern ? http : inMemory(Client, InMemoryTransport), auth: (authInfo) => ({ http: { authInfo } }),
    req: (headers) => ({ http: { req: new Request("http://localhost/mcp", { headers }) } }), v2: true };
};

for (const [label, setup] of [
  ["sdk v1", v1],
  ["server 2.4, 2025 protocol", v2("@modelcontextprotocol/server")], ["server 2.4, 2026-07-28", v2("@modelcontextprotocol/server", true)],
  ["server 2.3.1, 2025 protocol", v2("server-2.3.1")], ["server 2.3.1, 2026-07-28", v2("server-2.3.1", true)],
]) {
  const S = await setup(), { defineUi, html, testUi } = S.lib, pass = (c, m) => ok(c, `[${label}] ${m}`);
  const db = {};
  // The endpoint's bearer check: "t" is u1's token.
  const check = (req) => req.headers.get("authorization") === "Bearer t" && { token: "t", clientId: "app", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 60, extra: { sub: "u1" } };
  const ui = defineUi({ name: "t", attachTo: ["look"], web: { origin: "http://localhost:3912", secret: "test-secret-test-secret-test-secret-0123", mcp: S.endpoint(() => make(), check) }, view: async ({ user, params, call }) => html`<p>${user}: ${(db[user] ?? []).join()} ${params.q}</p><i>${(await call("look")).content?.[0]?.text}</i>` });
  let last, server;
  const make = () => {
    const s = server = ui.attach(new S.McpServer({ name: "t", version: "1" }));
    const tool = (name, cfg, h) => s.registerTool(name, { description: name, ...cfg }, h);
    tool("add", { inputSchema: S.shape({ item: z.string() }) }, async ({ item }, extra) => { (db[ui.identify(extra)] ??= []).push(item); return { content: [{ type: "text", text: "added" }] }; });
    tool("raw", { inputSchema: { n: z.coerce.number() } }, async ({ n }) => ({ content: [{ type: "text", text: "n=" + (n + 1) }] }));
    tool("look", { annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: "text", text: "seen" }] }));
    tool("ctx", {}, async (extra) => { last = extra; return { content: [{ type: "text", text: ui.identify(extra) }] }; });
    tool("elicit", {}, async (extra) => { await (S.v2 ? extra.mcpReq.elicitInput({ message: "m", requestedSchema: { type: "object", properties: {} } }) : s.server.elicitInput({ message: "m", requestedSchema: { type: "object", properties: {} } }, { relatedRequestId: extra.requestId })); return { content: [] }; });
    if (S.inputRequired) tool("ask", {}, async () => S.inputRequired({ inputRequests: { x: S.inputRequired.elicitUrl({ message: "m", url: "http://localhost/" }) } }));
    return s;
  };
  const c = await S.connect(make);

  // tools/list
  const tools = (await c.listTools()).tools, named = (n) => tools.find((t) => t.name === n);
  pass(tools.map((t) => t.name).join() === `open_t_in_browser,add,raw,look,ctx,elicit${S.v2 ? ",ask" : ""}`, "a plain client sees the server's tools and open_t_in_browser, not p_sync");
  pass(named("look")._meta.ui.resourceUri === "ui://t/app.html" && !named("add")._meta, "attachTo adds _meta.ui.resourceUri to that tool only");
  const app = await S.connect(make, { capabilities: APPS });
  const sync = (await app.listTools()).tools.find((t) => t.name === "p_sync");
  pass(sync?._meta.ui.visibility[0] === "app" && Object.keys(sync.inputSchema.properties).join() === "params,h", "an MCP Apps client lists p_sync, app-only, with its schema");
  pass(/^<!doctype html>/.test((await app.readResource({ uri: "ui://t/app.html" })).contents[0].text), "the UI resource is served");

  // p_sync: one check, answered at once
  const p = async (args, o) => (await app.callTool({ name: "p_sync", arguments: args }, ...(S.v2 ? [o] : [undefined, o]))).structuredContent;
  const first = await p({ params: { q: "<b>" } });
  pass(first.html?.includes("local:  &lt;b&gt;"), "p_sync renders for the user and their params");
  pass(first.html?.includes("<i>seen</i>"), "the view reads through call(), via this SDK's tools/call handler");
  pass(/Invalid/.test(textOf(await app.callTool({ name: "p_sync", arguments: { params: "x" } }))), "p_sync rejects params that are not an object");
  const at = { h: first.h, params: { q: "<b>" } };
  let t0 = Date.now();
  pass(!(await p(at)).html && Date.now() - t0 < 1000, "nothing changed: p_sync answers at once, with no HTML");
  await c.callTool({ name: "add", arguments: { item: "one" } });
  pass((await p(at)).html?.includes("one"), "after a change the next check sends the new HTML");
  pass(textOf(await c.callTool({ name: "raw", arguments: { n: "1" } })) === "n=2", "a tool with a raw zod shape still validates and coerces");

  // identity
  const sub = { token: "t", clientId: "app", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 60, extra: { sub: "u1" } };
  pass(textOf(await c.callTool({ name: "ctx", arguments: {} })) === "local", "no auth is the local user");
  const alice = await S.connect(make, { authInfo: sub });
  pass(textOf(await alice.callTool({ name: "ctx", arguments: {} })) === "u1", "the user is the token's subject");
  pass((await alice.callTool({ name: "p_sync", arguments: {} })).structuredContent.html.includes("u1:"), "p_sync renders for that user");
  const nobody = await S.connect(make, { authInfo: { ...sub, extra: {} } });
  const denied = await Promise.all(["ctx", "p_sync", "open_t_in_browser"].map((name) => nobody.callTool({ name, arguments: {} })));
  pass(denied.every((r) => r.isError && /No user id/.test(textOf(r))), "authenticated with no subject is refused everywhere, never the shared user");
  pass(/No user id/.test(await err(() => ui.identify(S.auth({ clientId: "app" })))), "ui.identify throws too");
  let given; const custom = defineUi({ name: "c", web: false, identify: (x) => (given = x, "me"), view: () => html`x` });
  const cs = await S.connect(() => custom.attach(new S.McpServer({ name: "c", version: "1" })), { authInfo: sub });
  await cs.callTool({ name: "p_sync", arguments: {} });
  pass(S.v2 ? given.http.authInfo.extra.sub === "u1" && given.mcpReq.method === "tools/call" : given.authInfo.extra.sub === "u1" && given.requestId != null, "a custom identify gets what the SDK passes to handlers");

  // open in browser, and the browser session's tool calls
  const opened = await alice.callTool({ name: "open_t_in_browser", arguments: {} }), link = linkIn(opened);
  pass(/Share this private link/.test(textOf(opened)) && /^http:\/\/localhost:3912\/ui\/l\//.test(link), "without URL elicitation the link comes back as text");
  const cookie = (await ui.site.fetch(new Request(link, { method: "POST" }))).headers.get("set-cookie").split(";")[0];
  const post = async (name, body = {}) => { const r = await ui.site.fetch(new Request("http://localhost:3912/ui/tool/" + name, { method: "POST", headers: { cookie, "P-Req": "1" }, body: JSON.stringify(body) })); return { status: r.status, text: await r.text() }; };
  pass(/added/.test((await post("add", { item: "web" })).text) && db.u1.join() === "web", "a browser tool call runs as the user who opened it");
  pass((await post("add", { item: {} })).status === 400, "its arguments go through the tool's own schema");
  await post("ctx");
  const m = last.mcpReq ?? {};
  if (S.v2) {
    pass(last.http.authInfo.extra.sub === "u1" && last.http.authInfo.token === "t" && last.http.req instanceof Request, "its context is a real request's, with the auth the endpoint checked and the real token");
    pass(m.method === "tools/call" && m.id && m.signal instanceof AbortSignal && m.requestState() === undefined && m.inputResponses === undefined, "its context has the v2 shape");
    const asked = await post("ask");
    pass(asked.status >= 400 && !asked.text.includes("input_required"), "a tool that needs the client's input fails from the browser instead of looking done");
  } else pass(last.authInfo.extra.sub === "u1" && last.authInfo.token === "t" && last.requestId != null && last.signal instanceof AbortSignal && last.requestInfo.headers.authorization === "Bearer t", "its extra is a real request's, with the auth the endpoint checked and the real token");
  t0 = Date.now(); const asked2 = await post("elicit");
  pass(asked2.status >= 400 && Date.now() - t0 < 2000, `a tool that asks the client from a browser call fails at once, it does not wait for an answer (${asked2.status}, ${Date.now() - t0} ms)`);
  const again = await post("open_t_in_browser");
  pass(again.status === 400 && /Not available/.test(again.text) && !/\/ui\/l\//.test(again.text), "a browser session cannot mint itself a new link");
  pass(/Not available/.test(await err(() => ui.link(last, server))) && /Not available/.test(await err(() => ui.link({ ...last }, server))), "nor with a copy of its context");

  // elicitation
  const elicit = (action) => S.connect(make, { capabilities: URLS, onElicit: (cl) => S.onElicit(cl, async (r) => { seen = r.params; if (!action) throw new Error("gave up"); return { action }; }) });
  let seen;
  if (S.modern) {
    const r = await (await elicit("accept")).callTool({ name: "open_t_in_browser", arguments: {} });
    pass(!!linkIn(r) && !r.isError, "a protocol where the server cannot ask: the link comes back as text");
  } else {
    const yes = await (await elicit("accept")).callTool({ name: "open_t_in_browser", arguments: {} });
    pass(/^Opened t/.test(textOf(yes)) && seen.mode === "url" && /\/ui\/l\//.test(seen.url) && seen.elicitationId, "URL elicitation is sent to the client and accepted");
    pass(/declined/.test(textOf(await (await elicit("decline")).callTool({ name: "open_t_in_browser", arguments: {} }))), "a declined elicitation is reported, with no link");
    pass(!!linkIn(await (await elicit()).callTool({ name: "open_t_in_browser", arguments: {} })), "a failed elicitation hands back the link");
  }

  // remote user, no origin
  const local = defineUi({ name: "l", view: () => html`x` }), ls = local.attach(new S.McpServer({ name: "l", version: "1" }));
  const from = (host) => err(() => local.openInBrowser(S.req({ host }), { server: ls }));
  pass(/web\.origin/.test(await from("app.example.com")) && await from("localhost:8080") === "", "a remote request with no origin is refused; a loopback one is not");
  if (S.modern) {
    const make2 = () => local.attach(new S.McpServer({ name: "l", version: "1" }));
    const call = async (host) => textOf(await (await S.connect(make2, { host })).callTool({ name: "open_l_in_browser", arguments: {} }));
    pass(/web\.origin/.test(await call("app.example.com")) && /127\.0\.0\.1/.test(await call("localhost")), "the same from a real request, by its URL when there is no Host header");
  }
  local.site.close();

  // registration styles and order
  const low = defineUi({ name: "low", web: false, view: () => html`x` }), lows = low.attach(new S.McpServer({ name: "low", version: "1" }));
  if (S.v2) {
    const any = z.object({ name: z.string() }).loose();
    lows.server.setRequestHandler("tools/call", { params: any }, async (params) => ({ content: [{ type: "text", text: "got " + params.name }] }));
    lows.server.setRequestHandler("custom/hi", { params: z.object({ a: z.number() }), result: z.any() }, async ({ a }) => ({ a }));
    const lc = await S.connect(() => lows);
    pass(textOf(await lc.callTool({ name: "anything", arguments: {} })) === "got anything", "the three-argument setRequestHandler works");
    if (!S.modern) pass((await lc.request({ method: "custom/hi", params: { a: 1 } }, z.object({ a: z.number() }))).a === 1, "a custom method is left alone");
  }
  const late = new S.McpServer({ name: "late", version: "1" });
  late.registerTool("x", { description: "x" }, async () => ({ content: [] }));
  pass(/before any tool is registered/.test(await err(() => low.attach(late))), "attach after registerTool fails loudly");
  pass(/already called/.test(await err(() => low.attach(lows))), "attach twice fails loudly");

  // the test harness, with this SDK's client (v2 from a project without v1)
  const t = await testUi(make), v = await t.mount();
  await t.agent.callTool({ name: "add", arguments: { item: "two" } });
  await v.until((s) => s.includes("two"));
  await v.click("add", { item: "three" });
  pass(v.text().includes("three") && t.resourceUri === "ui://t/app.html", "testUi drives the server: agent call, live update, click");
  v.close(); await t.close();
  if (S.v2) {
    const mixed = await (await load(join(ROOT, "dist"))).testUi(make), mv = await mixed.mount();
    await mixed.agent.callTool({ name: "add", arguments: { item: "four" } });
    await mv.until((s) => s.includes("four"));
    pass(true, "testUi with the v1 client drives a v2 server");
    mv.close(); await mixed.close();
  }
  ui.site.close();
}

console.log(fails ? `\n${fails} FAILED` : "\nall SDK checks passed");
process.exit(fails ? 1 : 0);
