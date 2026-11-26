const NS = new URL("../examples/notes-server", import.meta.url).pathname;
const { testUi } = await import(`${NS}/node_modules/mcp-projector/dist/testing.js`);
const { defineUi, html } = await import(`${NS}/node_modules/mcp-projector/dist/index.js`);
const { McpServer } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`);
const { createServer } = await import(`${NS}/dist/server.js`);
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const err = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };

// --- harness: agent + UI on the real server ---
const t = await testUi(createServer);
ok(t.resourceUri === "ui://notes/app.html", "resource discovered from list_notes");
ok(t.modelTools.map((x) => x.name).sort().join() === "add_note,list_notes,open_notes_in_browser,pin_note", "model sees its own tools + the opt-in browser tool only");
ok(!t.tools.some((x) => x.name === "p_sync"), "p_sync is not listed for a client without MCP Apps");
{
  const { Client } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
  const { InMemoryTransport } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`);
  const [a, b] = InMemoryTransport.createLinkedPair(); await createServer().connect(b);
  const app = new Client({ name: "apps-host", version: "1" }, { capabilities: { extensions: { "io.modelcontextprotocol/ui": {} } } });
  await app.connect(a);
  const sync = (await app.listTools()).tools.find((x) => x.name === "p_sync");
  ok(sync?._meta?.ui?.visibility?.[0] === "app", "an MCP Apps client lists p_sync, marked app-only");
  await app.close();
}
const v = await t.mount();
ok(v.text().includes("No notes yet"), "empty state renders");
await t.agent.callTool({ name: "add_note", arguments: { title: "Agent note", body: "from the model" } });
await v.until((s) => s.includes("Agent note"));
ok(/Notes 1 Pinned 0/.test(v.text()), "agent tool call → open UI re-rendered, nothing declared");
await v.click("pin_note", { id: 1 });
ok(v.html().includes("Pinned</span>"), "UI click → pin_note → UI shows it");
ok((await t.agent.callTool({ name: "list_notes", arguments: {} })).content[0].text.includes("(pinned)"), "agent sees the human's change");
ok(/Invalid arguments for tool add_note/.test(await err(() => v.click("add_note", { title: { evil: true } }))) && !v.text().includes("[object Object]"), "UI call with bad args is rejected by the tool's own schema");
await v.click("pin_note", { id: "1" });
ok(!(await t.agent.callTool({ name: "list_notes", arguments: {} })).content[0].text.includes("(pinned)"), "UI args are coerced by the schema (id \"1\" → 1)");
ok(/not found/.test(await err(() => v.click("nope"))), "a tool error reaches the UI as an error");
await v.set({ q: "zzz" });
ok(!v.text().includes("Agent note") && v.text().includes("No notes yet"), "view params: set({ q }) re-renders for this viewer only");
const other = await t.mount();
ok(other.text().includes("Agent note"), "another viewer has its own params");
await v.set({ q: "agent" });
ok(v.text().includes("Agent note"), "params change again");
v.close(); other.close(); await t.close();

// --- sync: one check, answered at once; HTML only when it changed; nothing kept between checks ---
const db = { alice: ["a1"], bob: ["b1"] };
const ui = defineUi({ name: "t", view: async ({ user, params }) =>
  html`<ul>${db[user].filter((i) => !params.only || i === params.only).map((i) => html`<li>${i}</li>`)}</ul>`, web: false });
const A = await ui.sync("alice"), B = await ui.sync("bob");
ok(A.html.includes("a1") && !A.html.includes("b1") && B.html.includes("b1"), "per-user render");
let t0 = Date.now();
const same = await ui.sync("alice", A);
ok(!same.html && same.h === A.h && Date.now() - t0 < 100, "nothing changed → answers at once, with no HTML");
db.alice.push("a2");
const A2 = await ui.sync("alice", A);
ok(A2.html?.includes("a2") && A2.h !== A.h, "data changed → the next check sends the new HTML");
ok(!(await ui.sync("bob", B)).html, "bob's view did not change: nothing sent");
ok((await ui.sync("alice", { h: A2.h, params: { only: "a2" } })).html.includes("<li>a2</li></ul>"), "params are part of the render");
const twin = defineUi({ name: "t", view: async ({ user, params }) =>
  html`<ul>${db[user].filter((i) => !params.only || i === params.only).map((i) => html`<li>${i}</li>`)}</ul>`, web: false });
ok(!(await twin.sync("alice", A2)).html, "another instance answers a page from the first: nothing is kept between checks");
ok(/<li>&lt;b&gt;<\/li>/.test(await defineUi({ name: "e", view: () => html`<li>${"<b>"}</li>` }).render()), "render() escapes values");

ok(/Results for \[object Object\]/.test(await defineUi({ name: "e", view: ({ params }) => html`Results for ${params.q}` }).render({ q: { __html: "<img src=x onerror=alert(1)>" } })),
  "a JSON { __html } value is escaped, not trusted as HTML");

// --- web mode: Node adapter and session limits ---
{
  const http = await import("node:http");
  const { WebStandardStreamableHTTPServerTransport: WST } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js`);
  const mk = () => {
    const ws = w.attach(new McpServer({ name: "w", version: "1" }));
    ws.registerTool("peek", { description: "read", annotations: { readOnlyHint: true } }, async () => ({ content: [] }));
    ws.registerTool("poke", { description: "write" }, async () => ({ content: [] }));
    return ws;
  };
  const mcp = async (req) => { const tr = new WST({ sessionIdGenerator: undefined, enableJsonResponse: true }); await mk().connect(tr); return tr.handleRequest(req); };
  const w = defineUi({ name: "w", web: { origin: "http://localhost:3911", secret: "test-secret-test-secret-test-secret-0123", tool: "open_w", mcp }, view: ({ params }) => { if (params.boom) throw new Error("boom"); return html`<p>hi</p>`; } });
  const ws = mk();
  const { Client } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
  const { InMemoryTransport } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`);
  const [ca, cb] = InMemoryTransport.createLinkedPair();
  await ws.connect(cb);
  const c = new Client({ name: "agent", version: "1" }); await c.connect(ca);
  const link = (await c.callTool({ name: "open_w", arguments: {} })).content[0].text.match(/http\S+/)[0];
  const cookie = (await w.site.fetch(new Request(link, { method: "POST" }))).headers.get("set-cookie").split(";")[0];
  const post = (path, body = "{}") => w.site.fetch(new Request("http://localhost:3911/ui" + path, { method: "POST", headers: { cookie, "P-Req": "1" }, body }));
  const again = await post("/tool/open_w");
  ok(again.status === 400 && !/\/ui\/l\//.test(await again.text()), "a browser session cannot mint itself a new link");

  const link2 = (await c.callTool({ name: "open_w", arguments: {} })).content[0].text.match(/http\S+/)[0];
  const redeem = (headers) => w.site.fetch(new Request(link2, { method: "POST", headers })).then((r) => r.status);
  ok(await redeem({ "sec-fetch-site": "cross-site" }) === 403 && await redeem({ origin: "https://evil.example" }) === 403, "another site cannot redeem a link into this browser");
  ok(await redeem({ "sec-fetch-site": "same-origin", origin: "http://localhost:3911" }) === 303, "the Continue page itself still redeems it");

  // web mode is on by default: a default tool, and without an origin projector serves the UI on 127.0.0.1 itself
  const plain = async (opts) => {
    const d = defineUi({ name: "my notes", view: () => html`<p>local</p>`, ...opts });
    const s = d.attach(new McpServer({ name: "d", version: "1" }));
    const [pa, pb] = InMemoryTransport.createLinkedPair(); await s.connect(pb);
    const pc = new Client({ name: "plain", version: "1" }); await pc.connect(pa);   // no elicitation: the link comes back as text
    return { d, s, names: (await pc.listTools()).tools.map((t) => t.name), call: (n) => pc.callTool({ name: n, arguments: {} }) };
  };
  const on = await plain({});
  ok(on.names.includes("open_my_notes_in_browser"), "web mode is on by default, with a default open-in-browser tool");
  const local = (await on.call("open_my_notes_in_browser")).content[0].text.match(/http\S+/)[0];
  ok(/^http:\/\/127\.0\.0\.1:\d+\/ui\/l\//.test(local) && (await fetch(local)).status === 200, "without an origin the link points at a listener on 127.0.0.1 that serves it");
  const lr = await fetch(local, { method: "POST", redirect: "manual" }), lport = new URL(local).port;
  ok(lr.status === 303 && lr.headers.get("set-cookie").startsWith(`p_my_notes_ui_${lport}=`), `the local listener's cookie name carries its port, so two local servers keep apart (${lr.headers.get("set-cookie").split("=")[0]})`);
  const lp = await fetch(new URL("/ui/", local), { headers: { cookie: lr.headers.get("set-cookie").split(";")[0] } });
  ok(lp.status === 200 && (await lp.text()).includes("<p>local</p>"), "...and its browser calls run in this process, on the attached server");
  const asHost = (host) => new Promise((done) => import("node:http").then((h) => h.get(local.replace(/\/l\/.*/, "/x"), { headers: { host } }, (r) => { r.resume(); done(r.statusCode); })));
  ok(await asHost("evil.example") === 421 && await asHost(new URL(local).host) === 401, "the 127.0.0.1 listener refuses a request naming another Host (DNS rebinding)");
  const remote = (host) => err(() => on.d.openInBrowser({ requestInfo: { headers: { host } } }, { server: on.s }));
  ok(/web\.origin/.test(await remote("app.example.com")) && await remote("localhost:8080") === "", "a remote request with no origin is refused instead of getting a 127.0.0.1 link; a loopback one is not");
  on.d.site.close();
  ok(/still starting/.test(await err(() => on.d.link({}, on.s))), "after close, no links point at the closed listener");
  {
    const { ElicitRequestSchema } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js`);
    const d = defineUi({ name: "el", view: () => html`<p>x</p>` }), es = d.attach(new McpServer({ name: "d", version: "1" }));
    const [ea, eb] = InMemoryTransport.createLinkedPair(); await es.connect(eb);
    const ec = new Client({ name: "el", version: "1" }, { capabilities: { elicitation: { url: {} } } });
    ec.setRequestHandler(ElicitRequestSchema, async () => { throw new Error("host gave up"); });
    await ec.connect(ea);
    const text = (await ec.callTool({ name: "open_el_in_browser", arguments: {} })).content[0].text;
    ok(/Share this private link.*http:\/\/127\.0\.0\.1/.test(text), "when URL elicitation fails, the tool hands back the link instead of an error");
    d.site.close();
  }
  ok(!(await plain({ web: false })).names.some((n) => n.includes("browser")), "web: false turns web mode off");
  const noTool = await plain({ web: { tool: false } });
  ok(!noTool.names.some((n) => n.includes("browser")) && noTool.d.site, "tool: false keeps web mode but adds no model-visible tool");

  ok(w.identify({}) === "local" && w.identify({ authInfo: { clientId: "app", extra: { sub: "u1" } } }) === "u1", "identity: no auth is local, otherwise the token's subject");
  ok(/extra\.sub/.test(await err(() => w.identify({ authInfo: { clientId: "app" } }))), "identity: an authenticated request with no subject is refused, not mapped to the client id");
  ok(/attached server/.test(await err(() => w.openInBrowser({}))), "ui.openInBrowser needs the server the request belongs to");
  const anon = defineUi({ name: "a", identify: () => undefined, view: () => html`x` });
  ok(/No user id/.test(await err(() => anon.identify({}))), "identity: an identify() that returns nothing is refused, not mapped to a shared user");
  ok(/must return html/.test(await err(() => defineUi({ name: "v", view: () => ({ __html: "<script>" }) }).render())), "a view that returns a hand-built { __html } object is refused");
  ok(/<\/style/.test(await err(() => defineUi({ name: "c", css: "</style><script>", view: () => html`x` }))), "css that would close the style element is refused");
  const { attrs, Menu } = await import(`${NS}/node_modules/mcp-projector/dist/index.js`);
  ok(attrs({ "x onmouseover=alert(1) y": "1", ok: "1" }).__html === ' ok="1"', "attrs drops a name that would start a second attribute");
  ok(!/javascript:/.test(Menu({ id: "m", items: [{ label: "x", href: "javascript:alert(1)" }, { label: "y", href: "https://example.com" }] }).__html), "Menu drops a javascript: href");

  const bad = await post("/sync", JSON.stringify({ params: null }));
  ok(bad.status === 200 && (await post("/sync", JSON.stringify({ params: "x" }))).status === 200, "web sync treats params that are not an object as none");
  ok((await post("/tool/p_sync")).status === 404, "p_sync is not reachable as a web tool call: sync has its own route");
  const cur = await (await post("/sync")).json(), same2 = await (await post("/sync", JSON.stringify({ h: cur.h }))).json();
  ok(cur.html && !same2.html && same2.h === cur.h, "web sync answers at once, with HTML only when the page's hash differs");

  let rejected = 0; const onRej = () => rejected++; process.on("unhandledRejection", onRej);
  let downstream = -1;
  const srv = http.createServer((req, res) => w.site.node(req, res, async () => { let s = ""; for await (const ch of req) s += ch; downstream = s.length; res.end("ok"); }));
  await new Promise((r) => srv.listen(3911, r));
  await fetch("http://localhost:3911/other", { method: "POST", body: "hello" });
  ok(downstream === 5, "site.node leaves the body of routes it does not own for the next handler");
  const status = (opts, body) => new Promise((r) => { const q = http.request({ port: 3911, ...opts }, (res) => { res.resume(); r(res.statusCode); }); q.on("error", () => r(0)); q.end(body); });
  ok(await status({ method: "TRACE", path: "/ui/" }) === 500 && !rejected, "an unsupported method gets a 500, not an unhandled rejection");
  ok(await status({ method: "POST", path: "/ui/sync" }, Buffer.alloc(1_100_000)) === 413, "a body over 1 MB is refused with 413");
  process.off("unhandledRejection", onRej);
  srv.closeAllConnections(); srv.close(); w.site.close(); await c.close();
}

// --- the view reads through the server's own tools, as the viewer, read tools only ---
{
  const runs = { who: 0, poke: 0 };
  const { WebStandardStreamableHTTPServerTransport } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js`);
  // The server's own MCP endpoint, in process, with a bearer check of its own: "t-<sub>" is that user's token.
  const mcp = async (req) => {
    const t = /^Bearer t-(\w+)$/.exec(req.headers.get("authorization") ?? "");
    if (!t) return new Response(null, { status: 401 });
    const tr = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await make().connect(tr);
    return tr.handleRequest(req, { authInfo: { token: t[0].slice(7), clientId: "app", scopes: [], extra: { sub: t[1] } } });
  };
  const r = defineUi({ name: "r", reads: ["count"], web: { origin: "https://r.test", secret: "test-secret-test-secret-test-secret-0123", mcp }, view: async ({ call, params }) => {
    const out = await call(params.tool ?? "who", params.args);
    return html`<p>${out.content?.[0]?.text}</p>`;
  } });
  const make = () => {
    const rs = r.attach(new McpServer({ name: "r", version: "1" }));
    rs.registerTool("who", { description: "read", annotations: { readOnlyHint: true } }, async (extra) => { runs.who++; return { content: [{ type: "text", text: "user=" + (extra.authInfo?.extra?.sub ?? "none") }] }; });
    rs.registerTool("count", { description: "a read the server did not annotate" }, async () => ({ content: [{ type: "text", text: "count=1" }] }));
    rs.registerTool("poke", { description: "write" }, async () => { runs.poke++; return { content: [{ type: "text", text: "poked" }] }; });
    return rs;
  };
  const rs = make();
  const { Client } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
  const { InMemoryTransport } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`);
  const [ra, rb] = InMemoryTransport.createLinkedPair(); await rs.connect(rb);
  const rc = new Client({ name: "host", version: "1" }, { capabilities: { extensions: { "io.modelcontextprotocol/ui": {} } } }); await rc.connect(ra);
  const psync = async (params = {}) => { const x = await rc.callTool({ name: "p_sync", arguments: { params } }); return x.isError ? { error: x.content[0].text } : x.structuredContent; };

  const s1 = await psync();
  ok(s1.html?.includes("user=none") && runs.who === 1, "the view gets its data by calling a read tool through the server's tools/call handler");
  ok((await psync({ tool: "count" })).html?.includes("count=1"), "a tool listed in reads can be called from the view without editing the server");
  const refused = await psync({ tool: "poke" });
  ok(/only call read tools/.test(refused.error ?? "") && runs.poke === 0, "a view cannot call a tool that may change data: refused before it runs");
  ok(/only call read tools/.test((await psync({ tool: "p_sync" })).error ?? "") && /only call read tools/.test((await psync({ tool: "open_r_in_browser" })).error ?? ""),
    "a view cannot call p_sync or the open-in-browser tool, though that one is read-only");
  ok(/call needs a viewer/.test(await err(() => r.render())), "render() outside a request says why call is unavailable");

  // On the web the view reads as the user whose token the link carries, checked by the server's endpoint.
  const as = (sub) => ({ authInfo: { token: "t-" + sub, clientId: "app", scopes: [], extra: { sub } } });
  const page = async (sub) => {
    const res = await r.site.fetch(new Request(await r.link(as(sub)), { method: "POST", headers: { "sec-fetch-site": "same-origin" } }));
    const cookie = res.headers.get("set-cookie").split(";")[0];
    return (await r.site.fetch(new Request("https://r.test/ui/", { headers: { cookie } }))).text();
  };
  const [pa, pb] = await Promise.all([page("alice"), page("bob")]);
  ok(pa.includes("user=alice") && pb.includes("user=bob") && !pa.includes("bob"), "on the web the view's tool calls carry the token's user, and two users never share a render");
  const nm = defineUi({ name: "nm", view: () => html`x` }); await nm.site.listen();
  ok(/Set web\.mcp/.test(await err(() => nm.link(as("alice")))), "minting a link from an authenticated request without web.mcp throws, saying what to set");
  nm.site.close();
  ok(/web\.origin must be https/.test(await err(() => defineUi({ name: "h", web: { origin: "http://r.test", secret: "test-secret-test-secret-test-secret-0123" }, view: () => html`x` }))),
    "a plain-http origin that is not this machine is refused: the cookie carries a bearer token");
  await rc.close();
}

// --- a request from another host gets no 127.0.0.1 link, however its Host header is spelled ---
{
  const loc = defineUi({ name: "loc", view: () => html`x` }), ls = loc.attach(new McpServer({ name: "loc", version: "1" }));
  const from = (host) => err(() => loc.openInBrowser({ requestInfo: { headers: { host } } }, { server: ls }));
  ok(/Set web.origin/.test(await from("localhost.evil.com")) && /Set web.origin/.test(await from("127.0.0.1.evil.com")) && /Set web.origin/.test(await from("app.example.com")),
    "a remote Host that only starts like localhost is refused");
  loc.site.close();
}

// --- attach order ---
const late = new McpServer({ name: "late", version: "1" });
late.registerTool("x", { description: "x" }, async () => ({ content: [] }));
ok(/before any tool is registered/.test(await err(() => ui.attach(late))), "attach after registerTool fails loudly, naming the fix");

console.log(fails ? `\n${fails} FAILED` : "\nall unit checks passed");
process.exit(fails ? 1 : 0);
