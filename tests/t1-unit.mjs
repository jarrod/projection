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
ok((await ui.sync("alice", { ...A2, params: { only: "a2" } })).html.includes("<li>a2</li></ul>"), "params are part of the render");
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
