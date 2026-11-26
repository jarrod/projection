import { describe, test, expect, beforeAll, afterAll } from "vitest";

const NS = new URL("../examples/notes-server", import.meta.url).pathname;
const { testUi } = await import(`${NS}/node_modules/mcp-projector/dist/testing.js`);
const { defineUi, html, attrs, Menu } = await import(`${NS}/node_modules/mcp-projector/dist/index.js`);
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
const { createServer } = await import(`${NS}/dist/server.js`);
const http = await import("node:http");
const err = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };
const SECRET = "test-secret-test-secret-test-secret-0123";
// A tool handler's context for an HTTP request that named this Host.
const from = (host) => ({ http: { req: new Request("http://localhost/mcp", { headers: { host } }) } });

describe("harness: agent + UI on the real server", () => {
  let t, v, other;
  beforeAll(async () => { t = await testUi(createServer); });
  afterAll(async () => { v?.close(); other?.close(); await t?.close(); });

  test("resource discovered from list_notes", () => {
    expect(t.resourceUri).toBe("ui://notes/app.html");
  });
  test("model sees its own tools + the opt-in browser tool only", () => {
    expect(t.modelTools.map((x) => x.name).sort()).toEqual(["add_note", "list_notes", "open_notes_in_browser", "pin_note"]);
  });
  test("p_sync is not listed for a client without MCP Apps", () => {
    expect(t.tools.map((x) => x.name)).not.toContain("p_sync");
  });
  test("an MCP Apps client lists p_sync, marked app-only", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair(); await createServer().connect(b);
    const app = new Client({ name: "apps-host", version: "1" }, { capabilities: { extensions: { "io.modelcontextprotocol/ui": {} } } });
    await app.connect(a);
    try {
      const sync = (await app.listTools()).tools.find((x) => x.name === "p_sync");
      expect(sync?._meta?.ui?.visibility?.[0]).toBe("app");
    } finally { await app.close(); }
  });
  test("empty state renders", async () => {
    v = await t.mount();
    expect(v.text()).toContain("No notes yet");
  });
  test("agent tool call → open UI re-rendered, nothing declared", async () => {
    await t.agent.callTool({ name: "add_note", arguments: { title: "Agent note", body: "from the model" } });
    await v.until((s) => s.includes("Agent note"));
    expect(v.text()).toMatch(/Notes 1 Pinned 0/);
  });
  test("UI click → pin_note → UI shows it", async () => {
    await v.click("pin_note", { id: 1 });
    expect(v.html()).toContain("Pinned</span>");
  });
  test("agent sees the human's change", async () => {
    expect((await t.agent.callTool({ name: "list_notes", arguments: {} })).content[0].text).toContain("(pinned)");
  });
  test("UI call with bad args is rejected by the tool's own schema", async () => {
    expect(await err(() => v.click("add_note", { title: { evil: true } }))).toMatch(/Invalid arguments for tool add_note/);
    expect(v.text()).not.toContain("[object Object]");
  });
  test("UI args are coerced by the schema (id \"1\" → 1)", async () => {
    await v.click("pin_note", { id: "1" });
    expect((await t.agent.callTool({ name: "list_notes", arguments: {} })).content[0].text).not.toContain("(pinned)");
  });
  test("a tool error reaches the UI as an error", async () => {
    expect(await err(() => v.click("nope"))).toMatch(/not found/);
  });
  test("view params: set({ q }) re-renders for this viewer only", async () => {
    await v.set({ q: "zzz" });
    expect(v.text()).not.toContain("Agent note");
    expect(v.text()).toContain("No notes yet");
  });
  test("another viewer has its own params", async () => {
    other = await t.mount();
    expect(other.text()).toContain("Agent note");
  });
  test("params change again", async () => {
    await v.set({ q: "agent" });
    expect(v.text()).toContain("Agent note");
  });
});

// Shared with "attach order" below.
const db = { alice: ["a1"], bob: ["b1"] };
const listView = async ({ user, params }) =>
  html`<ul>${db[user].filter((i) => !params.only || i === params.only).map((i) => html`<li>${i}</li>`)}</ul>`;
const ui = defineUi({ name: "t", view: listView, web: false });

describe("sync: one check, answered at once; HTML only when it changed; nothing kept between checks", () => {
  let A, B, A2;
  test("per-user render", async () => {
    A = await ui.sync("alice"); B = await ui.sync("bob");
    expect(A.html).toContain("a1");
    expect(A.html).not.toContain("b1");
    expect(B.html).toContain("b1");
  });
  test("nothing changed → answers at once, with no HTML", async () => {
    const t0 = Date.now();
    const same = await ui.sync("alice", A);
    const ms = Date.now() - t0;
    expect(same.html).toBeFalsy();
    expect(same.h).toBe(A.h);
    expect(ms).toBeLessThan(100);
  });
  test("data changed → the next check sends the new HTML", async () => {
    db.alice.push("a2");
    A2 = await ui.sync("alice", A);
    expect(A2.html).toContain("a2");
    expect(A2.h).not.toBe(A.h);
  });
  test("bob's view did not change: nothing sent", async () => {
    expect((await ui.sync("bob", B)).html).toBeFalsy();
  });
  test("params are part of the render", async () => {
    expect((await ui.sync("alice", { h: A2.h, params: { only: "a2" } })).html).toContain("<li>a2</li></ul>");
  });
  test("another instance answers a page from the first: nothing is kept between checks", async () => {
    const twin = defineUi({ name: "t", view: listView, web: false });
    expect((await twin.sync("alice", A2)).html).toBeFalsy();
  });
  test("render() escapes values", async () => {
    expect(await defineUi({ name: "e", view: () => html`<li>${"<b>"}</li>` }).render()).toMatch(/<li>&lt;b&gt;<\/li>/);
  });
  test("a JSON { __html } value is escaped, not trusted as HTML", async () => {
    expect(await defineUi({ name: "e", view: ({ params }) => html`Results for ${params.q}` }).render({ q: { __html: "<img src=x onerror=alert(1)>" } }))
      .toMatch(/Results for \[object Object\]/);
  });
});

describe("web mode: Node adapter and session limits", () => {
  let w, c, cookie, post, redeem, on, local, localRedeem, srv;
  const mk = () => {
    const ws = w.attach(new McpServer({ name: "w", version: "1" }));
    ws.registerTool("peek", { description: "read", annotations: { readOnlyHint: true } }, async () => ({ content: [] }));
    ws.registerTool("poke", { description: "write" }, async () => ({ content: [] }));
    return ws;
  };
  const mcp = (req) => createMcpHandler(mk).fetch(req);
  const openLink = async () => (await c.callTool({ name: "open_w", arguments: {} })).content[0].text.match(/http\S+/)[0];
  // web mode is on by default: a default tool, and without an origin projector serves the UI on 127.0.0.1 itself
  const plain = async (opts) => {
    const d = defineUi({ name: "my notes", view: () => html`<p>local</p>`, ...opts });
    const s = d.attach(new McpServer({ name: "d", version: "1" }));
    const [pa, pb] = InMemoryTransport.createLinkedPair(); await s.connect(pb);
    const pc = new Client({ name: "plain", version: "1" }); await pc.connect(pa); // no elicitation: the link comes back as text
    return { d, s, names: (await pc.listTools()).tools.map((t) => t.name), call: (n) => pc.callTool({ name: n, arguments: {} }) };
  };
  const status = (opts, body) => new Promise((r) => { const q = http.request({ port: 3911, ...opts }, (res) => { res.resume(); r(res.statusCode); }); q.on("error", () => r(0)); q.end(body); });

  beforeAll(async () => {
    w = defineUi({ name: "w", web: { origin: "http://localhost:3911", secret: SECRET, tool: "open_w", mcp }, view: ({ params }) => { if (params.boom) throw new Error("boom"); return html`<p>hi</p>`; } });
    const ws = mk();
    const [ca, cb] = InMemoryTransport.createLinkedPair();
    await ws.connect(cb);
    c = new Client({ name: "agent", version: "1" }); await c.connect(ca);
    cookie = (await w.site.fetch(new Request(await openLink(), { method: "POST" }))).headers.get("set-cookie").split(";")[0];
    post = (path, body = "{}") => w.site.fetch(new Request("http://localhost:3911/ui" + path, { method: "POST", headers: { cookie, "P-Req": "1" }, body }));
  });
  afterAll(async () => { srv?.closeAllConnections(); srv?.close(); w?.site.close(); await c?.close(); });

  test("a browser session cannot mint itself a new link", async () => {
    const again = await post("/tool/open_w");
    expect(again.status).toBe(400);
    expect(await again.text()).not.toMatch(/\/ui\/l\//);
  });
  test("another site cannot redeem a link into this browser", async () => {
    redeem = ((link2) => (headers) => w.site.fetch(new Request(link2, { method: "POST", headers })).then((r) => r.status))(await openLink());
    expect(await redeem({ "sec-fetch-site": "cross-site" })).toBe(403);
    expect(await redeem({ origin: "https://evil.example" })).toBe(403);
  });
  test("the Continue page itself still redeems it", async () => {
    expect(await redeem({ "sec-fetch-site": "same-origin", origin: "http://localhost:3911" })).toBe(303);
  });
  test("web mode is on by default, with a default open-in-browser tool", async () => {
    on = await plain({});
    expect(on.names).toContain("open_my_notes_in_browser");
  });
  test("without an origin the link points at a listener on 127.0.0.1 that serves it", async () => {
    local = (await on.call("open_my_notes_in_browser")).content[0].text.match(/http\S+/)[0];
    expect(local).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/ui\/l\//);
    expect((await fetch(local)).status).toBe(200);
  });
  test("the local listener's cookie name carries its port, so two local servers keep apart", async () => {
    localRedeem = await fetch(local, { method: "POST", redirect: "manual" });
    expect(localRedeem.status).toBe(303);
    expect(localRedeem.headers.get("set-cookie")).toMatch(new RegExp(`^p_my_notes_ui_${new URL(local).port}=`));
  });
  test("...and its browser calls run in this process, on the attached server", async () => {
    const lp = await fetch(new URL("/ui/", local), { headers: { cookie: localRedeem.headers.get("set-cookie").split(";")[0] } });
    expect(lp.status).toBe(200);
    expect(await lp.text()).toContain("<p>local</p>");
  });
  test("the 127.0.0.1 listener refuses a request naming another Host (DNS rebinding)", async () => {
    const asHost = (host) => new Promise((done) => http.get(local.replace(/\/l\/.*/, "/x"), { headers: { host } }, (r) => { r.resume(); done(r.statusCode); }));
    expect(await asHost("evil.example")).toBe(421);
    expect(await asHost(new URL(local).host)).toBe(401);
  });
  test("a remote request with no origin is refused instead of getting a 127.0.0.1 link; a loopback one is not", async () => {
    const remote = (host) => err(() => on.d.openInBrowser(from(host), { server: on.s }));
    expect(await remote("app.example.com")).toMatch(/web\.origin/);
    expect(await remote("localhost:8080")).toBe("");
  });
  test("after close, no links point at the closed listener", async () => {
    on.d.site.close();
    expect(await err(() => on.d.link({}, on.s))).toMatch(/still starting/);
  });
  test("when URL elicitation fails, the tool hands back the link instead of an error", async () => {
    const d = defineUi({ name: "el", view: () => html`<p>x</p>` }), es = d.attach(new McpServer({ name: "d", version: "1" }));
    try {
      const [ea, eb] = InMemoryTransport.createLinkedPair(); await es.connect(eb);
      const ec = new Client({ name: "el", version: "1" }, { capabilities: { elicitation: { url: {} } } });
      ec.setRequestHandler("elicitation/create", async () => { throw new Error("host gave up"); });
      await ec.connect(ea);
      const text = (await ec.callTool({ name: "open_el_in_browser", arguments: {} })).content[0].text;
      expect(text).toMatch(/Share this private link.*http:\/\/127\.0\.0\.1/);
    } finally { d.site.close(); }
  });
  test("web: false turns web mode off", async () => {
    expect((await plain({ web: false })).names.filter((n) => n.includes("browser"))).toEqual([]);
  });
  test("tool: false keeps web mode but adds no model-visible tool", async () => {
    const noTool = await plain({ web: { tool: false } });
    expect(noTool.names.filter((n) => n.includes("browser"))).toEqual([]);
    expect(noTool.d.site).toBeTruthy();
  });
  test("identity: no auth is local, otherwise the token's subject", () => {
    expect(w.identify({})).toBe("local");
    expect(w.identify({ http: { authInfo: { clientId: "app", extra: { sub: "u1" } } } })).toBe("u1");
  });
  test("identity: an authenticated request with no subject is refused, not mapped to the client id", async () => {
    expect(await err(() => w.identify({ http: { authInfo: { clientId: "app" } } }))).toMatch(/extra\.sub/);
  });
  test("ui.openInBrowser needs the server the request belongs to", async () => {
    expect(await err(() => w.openInBrowser({}))).toMatch(/attached server/);
  });
  test("identity: an identify() that returns nothing is refused, not mapped to a shared user", async () => {
    const anon = defineUi({ name: "a", identify: () => undefined, view: () => html`x` });
    expect(await err(() => anon.identify({}))).toMatch(/No user id/);
  });
  test("a view that returns a hand-built { __html } object is refused", async () => {
    expect(await err(() => defineUi({ name: "v", view: () => ({ __html: "<script>" }) }).render())).toMatch(/must return html/);
  });
  test("css that would close the style element is refused", async () => {
    expect(await err(() => defineUi({ name: "c", css: "</style><script>", view: () => html`x` }))).toMatch(/<\/style/);
  });
  test("attrs drops a name that would start a second attribute", () => {
    expect(attrs({ "x onmouseover=alert(1) y": "1", ok: "1" }).__html).toBe(' ok="1"');
  });
  test("Menu drops a javascript: href", () => {
    expect(Menu({ id: "m", items: [{ label: "x", href: "javascript:alert(1)" }, { label: "y", href: "https://example.com" }] }).__html).not.toMatch(/javascript:/);
  });
  test("web sync treats params that are not an object as none", async () => {
    expect((await post("/sync", JSON.stringify({ params: null }))).status).toBe(200);
    expect((await post("/sync", JSON.stringify({ params: "x" }))).status).toBe(200);
  });
  test("p_sync is not reachable as a web tool call: sync has its own route", async () => {
    expect((await post("/tool/p_sync")).status).toBe(404);
  });
  test("web sync answers at once, with HTML only when the page's hash differs", async () => {
    const cur = await (await post("/sync")).json(), same = await (await post("/sync", JSON.stringify({ h: cur.h }))).json();
    expect(cur.html).toBeTruthy();
    expect(same.html).toBeFalsy();
    expect(same.h).toBe(cur.h);
  });
  test("site.node leaves the body of routes it does not own for the next handler", async () => {
    let downstream = -1;
    srv = http.createServer((req, res) => w.site.node(req, res, async () => { let s = ""; for await (const ch of req) s += ch; downstream = s.length; res.end("ok"); }));
    await new Promise((r) => srv.listen(3911, r));
    await fetch("http://localhost:3911/other", { method: "POST", body: "hello" });
    expect(downstream).toBe(5);
  });
  test("an unsupported method gets a 500, not an unhandled rejection", async () => {
    let rejected = 0; const onRej = () => rejected++; process.on("unhandledRejection", onRej);
    try {
      expect(await status({ method: "TRACE", path: "/ui/" })).toBe(500);
      expect(rejected).toBe(0);
    } finally { process.off("unhandledRejection", onRej); }
  });
  test("a body over 1 MB is refused with 413", async () => {
    expect(await status({ method: "POST", path: "/ui/sync" }, Buffer.alloc(1_100_000))).toBe(413);
  });
});

describe("the view reads through the server's own tools, as the viewer, read tools only", () => {
  const runs = { who: 0, poke: 0 };
  let r, rc, psync;
  // The server's own MCP endpoint, in process, with a bearer check of its own: "t-<sub>" is that user's token.
  const mcp = async (req) => {
    const t = /^Bearer t-(\w+)$/.exec(req.headers.get("authorization") ?? "");
    if (!t) return new Response(null, { status: 401 });
    return createMcpHandler(make).fetch(req, { authInfo: { token: t[0].slice(7), clientId: "app", scopes: [], extra: { sub: t[1] } } });
  };
  const make = () => {
    const rs = r.attach(new McpServer({ name: "r", version: "1" }));
    rs.registerTool("who", { description: "read", annotations: { readOnlyHint: true } }, async (ctx) => { runs.who++; return { content: [{ type: "text", text: "user=" + (ctx.http?.authInfo?.extra?.sub ?? "none") }] }; });
    rs.registerTool("count", { description: "a read the server did not annotate" }, async () => ({ content: [{ type: "text", text: "count=1" }] }));
    rs.registerTool("poke", { description: "write" }, async () => { runs.poke++; return { content: [{ type: "text", text: "poked" }] }; });
    return rs;
  };
  // On the web the view reads as the user whose token the link carries, checked by the server's endpoint.
  const as = (sub) => ({ http: { authInfo: { token: "t-" + sub, clientId: "app", scopes: [], extra: { sub } } } });
  const page = async (sub) => {
    const res = await r.site.fetch(new Request(await r.link(as(sub)), { method: "POST", headers: { "sec-fetch-site": "same-origin" } }));
    const cookie = res.headers.get("set-cookie").split(";")[0];
    return (await r.site.fetch(new Request("https://r.test/ui/", { headers: { cookie } }))).text();
  };

  beforeAll(async () => {
    r = defineUi({ name: "r", reads: ["count"], web: { origin: "https://r.test", secret: SECRET, mcp }, view: async ({ call, params }) => {
      const out = await call(params.tool ?? "who", params.args);
      return html`<p>${out.content?.[0]?.text}</p>`;
    } });
    const rs = make();
    const [ra, rb] = InMemoryTransport.createLinkedPair(); await rs.connect(rb);
    rc = new Client({ name: "host", version: "1" }, { capabilities: { extensions: { "io.modelcontextprotocol/ui": {} } } }); await rc.connect(ra);
    psync = async (params = {}) => { const x = await rc.callTool({ name: "p_sync", arguments: { params } }); return x.isError ? { error: x.content[0].text } : x.structuredContent; };
  });
  afterAll(async () => { await rc?.close(); });

  test("the view gets its data by calling a read tool through the server's tools/call handler", async () => {
    const s1 = await psync();
    expect(s1.html).toContain("user=none");
    expect(runs.who).toBe(1);
  });
  test("a tool listed in reads can be called from the view without editing the server", async () => {
    expect((await psync({ tool: "count" })).html).toContain("count=1");
  });
  test("a view cannot call a tool that may change data: refused before it runs", async () => {
    expect((await psync({ tool: "poke" })).error ?? "").toMatch(/only call read tools/);
    expect(runs.poke).toBe(0);
  });
  test("a view cannot call p_sync or the open-in-browser tool, though that one is read-only", async () => {
    expect((await psync({ tool: "p_sync" })).error ?? "").toMatch(/only call read tools/);
    expect((await psync({ tool: "open_r_in_browser" })).error ?? "").toMatch(/only call read tools/);
  });
  test("render() outside a request says why call is unavailable", async () => {
    expect(await err(() => r.render())).toMatch(/call needs a viewer/);
  });
  test("on the web the view's tool calls carry the token's user, and two users never share a render", async () => {
    const [pa, pb] = await Promise.all([page("alice"), page("bob")]);
    expect(pa).toContain("user=alice");
    expect(pb).toContain("user=bob");
    expect(pa).not.toContain("bob");
  });
  test("minting a link from an authenticated request without web.mcp throws, saying what to set", async () => {
    const nm = defineUi({ name: "nm", view: () => html`x` }); await nm.site.listen();
    try { expect(await err(() => nm.link(as("alice")))).toMatch(/Set web\.mcp/); } finally { nm.site.close(); }
  });
  test("a plain-http origin that is not this machine is refused: the cookie carries a bearer token", async () => {
    expect(await err(() => defineUi({ name: "h", web: { origin: "http://r.test", secret: SECRET }, view: () => html`x` }))).toMatch(/web\.origin must be https/);
  });
});

describe("a request from another host gets no 127.0.0.1 link, however its Host header is spelled", () => {
  test("a remote Host that only starts like localhost is refused", async () => {
    const loc = defineUi({ name: "loc", view: () => html`x` }), ls = loc.attach(new McpServer({ name: "loc", version: "1" }));
    const of = (host) => err(() => loc.openInBrowser(from(host), { server: ls }));
    try {
      for (const host of ["localhost.evil.com", "127.0.0.1.evil.com", "app.example.com"]) expect(await of(host), `Host: ${host}`).toMatch(/Set web.origin/);
    } finally { loc.site.close(); }
  });
});

describe("attach order", () => {
  test("attach after registerTool fails loudly, naming the fix", async () => {
    const late = new McpServer({ name: "late", version: "1" });
    late.registerTool("x", { description: "x" }, async () => ({ content: [] }));
    expect(await err(() => ui.attach(late))).toMatch(/before any tool is registered/);
  });
});
