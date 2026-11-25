const NS = new URL("../examples/notes-server", import.meta.url).pathname;
const { testUi } = await import(`${NS}/node_modules/mcp-projection/dist/testing.js`);
const { defineUi, html } = await import(`${NS}/node_modules/mcp-projection/dist/index.js`);
const { McpServer } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`);
const { createServer } = await import(`${NS}/dist/server.js`);
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const err = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };

// --- harness: agent + UI on the real server ---
const t = await testUi(createServer);
ok(t.resourceUri === "ui://notes/app.html", "resource discovered from list_notes");
ok(t.modelTools.map((x) => x.name).sort().join() === "add_note,list_notes,open_notes_in_browser,pin_note", "model sees its own tools + the opt-in browser tool only");
ok(t.tools.length - t.modelTools.length === 1, "one hidden helper tool (p_sync)");
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

// --- sync: per-user render, unchanged-skip, wait and wake, never stale ---
const db = { alice: ["a1"], bob: ["b1"] };
let slow = 0;
const ui = defineUi({ name: "t", view: async ({ user, params }) => {
  const items = db[user].slice(); await new Promise((r) => setTimeout(r, slow));
  return html`<ul>${items.filter((i) => !params.only || i === params.only).map((i) => html`<li>${i}</li>`)}</ul>`;
} });
const A = await ui.sync("alice"), B = await ui.sync("bob");
ok(A.html.includes("a1") && !A.html.includes("b1") && B.html.includes("b1"), "per-user render");
let t0 = Date.now();
const idle = await ui.sync("alice", A, 40);
ok(!idle.html && Date.now() - t0 >= 35, "up to date → waits, then answers with no HTML");
t0 = Date.now();
const waitA = ui.sync("alice", A, 5000), waitB = ui.sync("bob", B, 5000);
db.alice.push("a2"); ui.write();
const A2 = await waitA, B2 = await waitB;
ok(A2.html?.includes("a2") && Date.now() - t0 < 1000, "write() wakes a waiting viewer with new HTML");
ok(!B2.html && B2.v === A2.v, "bob was woken but his HTML did not change: nothing sent");
ok((await ui.sync("alice", { h: A2.h, params: { only: "a2" } })).html.includes("<li>a2</li></ul>"), "params are part of the render");
slow = 40; const during = ui.sync("alice", { h: A2.h }); await new Promise((r) => setTimeout(r, 5));
db.alice.push("a3"); ui.write(); slow = 0;
const D = await during, after = await ui.sync("alice", D, 5000);
ok(after.html?.includes("a3"), "a write during a render is never lost: the next sync answers at once with it");
ok(/<li>&lt;b&gt;<\/li>/.test(await defineUi({ name: "e", view: () => html`<li>${"<b>"}</li>` }).render()), "render() escapes values");

ok(/Results for \[object Object\]/.test(await defineUi({ name: "e", view: ({ params }) => html`Results for ${params.q}` }).render({ q: { __html: "<img src=x onerror=alert(1)>" } })),
  "a JSON { __html } value is escaped, not trusted as HTML");
t0 = Date.now();
const gone = new AbortController(), held = err(() => ui.sync("alice", after, 5000, gone.signal));
gone.abort();
ok(/cancelled/.test(await held) && Date.now() - t0 < 1000, "a cancelled sync stops waiting and does not render");

// --- web mode: Node adapter and session limits ---
{
  const http = await import("node:http");
  const w = defineUi({ name: "w", web: { origin: "http://localhost:3911", tool: "open_w" }, view: ({ params }) => { if (params.boom) throw new Error("boom"); return html`<p>hi</p>`; } });
  const ws = w.attach(new McpServer({ name: "w", version: "1" }));
  ws.registerTool("peek", { description: "read", annotations: { readOnlyHint: true } }, async () => ({ content: [] }));
  ws.registerTool("poke", { description: "write" }, async () => ({ content: [] }));
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

  // web mode is on by default: a default tool, and without an origin projection serves the UI on 127.0.0.1 itself
  const plain = async (opts) => {
    const d = defineUi({ name: "my notes", view: () => html`<p>local</p>`, ...opts });
    const s = d.attach(new McpServer({ name: "d", version: "1" }));
    const [pa, pb] = InMemoryTransport.createLinkedPair(); await s.connect(pb);
    const pc = new Client({ name: "plain", version: "1" }); await pc.connect(pa);   // no elicitation: the link comes back as text
    return { d, names: (await pc.listTools()).tools.map((t) => t.name), call: (n) => pc.callTool({ name: n, arguments: {} }) };
  };
  const on = await plain({});
  ok(on.names.includes("open_my_notes_in_browser"), "web mode is on by default, with a default open-in-browser tool");
  const local = (await on.call("open_my_notes_in_browser")).content[0].text.match(/http\S+/)[0];
  ok(/^http:\/\/127\.0\.0\.1:\d+\/ui\/l\//.test(local) && (await fetch(local)).status === 200, "without an origin the link points at a listener on 127.0.0.1 that serves it");
  on.d.site.close();
  ok(!(await plain({ web: false })).names.some((n) => n.includes("browser")), "web: false turns web mode off");
  const noTool = await plain({ web: { tool: false } });
  ok(!noTool.names.some((n) => n.includes("browser")) && noTool.d.site, "tool: false keeps web mode but adds no model-visible tool");

  ok(w.identify({}) === "local" && w.identify({ authInfo: { clientId: "app", extra: { sub: "u1" } } }) === "u1", "identity: no auth is local, otherwise the token's subject");
  ok(/extra\.sub/.test(await err(() => w.identify({ authInfo: { clientId: "app" } }))), "identity: an authenticated request with no subject is refused, not mapped to the client id");
  ok(/attached server/.test(await err(() => w.link({}))) && /attached server/.test(await err(() => w.openInBrowser({}))), "ui.link and ui.openInBrowser need the server the request belongs to");
  const anon = defineUi({ name: "a", identify: () => undefined, view: () => html`x` });
  ok(/No user id/.test(await err(() => anon.identify({}))), "identity: an identify() that returns nothing is refused, not mapped to a shared user");
  ok(/must return html/.test(await err(() => defineUi({ name: "v", view: () => ({ __html: "<script>" }) }).render())), "a view that returns a hand-built { __html } object is refused");
  ok(/<\/style/.test(await err(() => defineUi({ name: "c", css: "</style><script>", view: () => html`x` }))), "css that would close the style element is refused");
  const { attrs, Menu } = await import(`${NS}/node_modules/mcp-projection/dist/index.js`);
  ok(attrs({ "x onmouseover=alert(1) y": "1", ok: "1" }).__html === ' ok="1"', "attrs drops a name that would start a second attribute");
  ok(!/javascript:/.test(Menu({ id: "m", items: [{ label: "x", href: "javascript:alert(1)" }, { label: "y", href: "https://example.com" }] }).__html), "Menu drops a javascript: href");

  // one render is shared by viewers asking for the same thing; a burst of writes wakes them once
  let runs = 0;
  const many = defineUi({ name: "m", view: async ({ params }) => { runs++; await new Promise((r) => setTimeout(r, 5)); return html`<p>${runs}${params.k}</p>`; } });
  const first = await many.sync("u"); runs = 0;
  const held20 = Array.from({ length: 20 }, () => many.sync("u", first, 5000)), other = many.sync("u", { ...first, params: { k: 1 } }, 5000);
  for (let i = 0; i < 10; i++) many.write();
  await Promise.all([...held20, other]);
  ok(runs === 2, `20 viewers of one view plus 1 of another, 10 writes: 2 renders (got ${runs})`);

  const fresh = w.attach(new McpServer({ name: "w2", version: "1" }));
  fresh.registerTool("peek", { description: "read", annotations: { readOnlyHint: true } }, async () => ({ content: [] }));
  const [fa, fb] = InMemoryTransport.createLinkedPair();
  await fresh.connect(fb);
  const fc = new Client({ name: "agent", version: "1" }); await fc.connect(fa);
  const f0 = await w.sync("local");
  let tf = Date.now(), fheld = w.sync("local", f0, 300);
  await fc.callTool({ name: "peek", arguments: {} }); await fheld;
  ok(Date.now() - tf >= 250, "readOnlyHint is known from registration: no tools/list needed first");
  await fc.close();

  const bad = await post("/sync", JSON.stringify({ params: null }));
  ok(bad.status === 200 && (await post("/sync", JSON.stringify({ params: "x" }))).status === 200, "web sync treats params that are not an object as none");
  ok((await post("/tool/p_sync")).status === 404, "p_sync is not reachable as a web tool call: sync has its own route");
  const cur = await w.sync("local");
  const gate = new AbortController(), polls = Array.from({ length: 9 }, () =>
    w.site.fetch(new Request("http://localhost:3911/ui/sync", { method: "POST", headers: { cookie, "P-Req": "1" }, body: JSON.stringify(cur), signal: gate.signal })).then((r) => r.status));
  ok(await Promise.race([polls[0], new Promise((r) => setTimeout(r, 500, "held"))]) === 500, "a ninth held poll on one browser session ends the oldest");
  gate.abort(); await Promise.allSettled(polls);


  await c.listTools();
  const s0 = await w.sync("local");
  let t1 = Date.now(), held = w.sync("local", s0, 300);
  await c.callTool({ name: "peek", arguments: {} }); await held;
  ok(Date.now() - t1 >= 250, "a readOnlyHint tool call wakes no viewer");
  t1 = Date.now(); held = w.sync("local", s0, 5000);
  await c.callTool({ name: "poke", arguments: {} }); await held;
  ok(Date.now() - t1 < 1000, "any other tool call still does");

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

// --- attach order ---
const late = new McpServer({ name: "late", version: "1" });
late.registerTool("x", { description: "x" }, async () => ({ content: [] }));
ok(/before any tool is registered/.test(await err(() => ui.attach(late))), "attach after registerTool fails loudly, naming the fix");

console.log(fails ? `\n${fails} FAILED` : "\nall unit checks passed");
process.exit(fails ? 1 : 0);
