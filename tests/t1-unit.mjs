const NS = new URL("../examples/notes-server", import.meta.url).pathname;
const { testUi } = await import(`${NS}/node_modules/mcp-projection/dist/testing.js`);
const { defineUi, html } = await import(`${NS}/node_modules/mcp-projection/dist/index.js`);
const { createEngine } = await import(`${NS}/node_modules/mcp-projection/dist/engine.js`);
const { createServer } = await import(`${NS}/dist/server.js`);
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };

// --- harness: agent + UI on the real server ---
const t = await testUi(createServer);
ok(t.resourceUri === "ui://notes/app.html", "resource discovered from list_notes");
ok(t.modelTools.map((x) => x.name).sort().join() === "add_note,list_notes,open_notes_in_browser,pin_note", "model sees baseline tools + the opt-in browser tool only");
const v = await t.mount();
ok(v.text().includes("No notes yet"), "empty state renders");
await t.agent.callTool({ name: "add_note", arguments: { title: "Agent note", body: "from the model" } });
await v.until((s) => s.includes("Agent note"));
ok(/Notes 1 Pinned 0/.test(v.text()), "stats fragment updated with the list (one write → all readers)");
await v.click("pin_note", { id: 1 });
ok(v.html().includes("Pinned</span>"), "UI click → pin_note → patch applied inline");
ok((await t.agent.callTool({ name: "list_notes", arguments: {} })).content[0].text.includes("(pinned)"), "agent sees the human's change");
let denied = false; try { await v.click("list_notes"); } catch (e) { denied = /may not call/.test(e.message); }
ok(denied, "UI cannot call tools outside writes");
v.close(); await t.close();

// --- engine: coalescing, memoized loads, unchanged-skip, per-user isolation ---
let loads = 0;
const db = { alice: ["a1"], bob: ["b1"] };
const e = createEngine({ load: { items: ({ user }) => (loads++, db[user]), other: () => 1 } });
e.fragment("list", async ({ read }) => html`<ul>${(await read("items")).map((i) => html`<li>${i}</li>`)}</ul>`);
e.fragment("count", async ({ read }) => html`<b>${(await read("items")).length}</b>`);
e.fragment("app", async ({ frag }) => html`${await frag("list")}${await frag("count")}`);
const A = await e.mount("alice", "app"), B = await e.mount("bob", "app");
ok(A.html.includes("a1") && !A.html.includes("b1") && B.html.includes("b1"), "per-user render isolation");
loads = 0;
db.alice.push("a2");
await Promise.all([e.write("items"), e.write("items"), e.write("items")]);
ok(loads === 2, `3 writes in one tick → one pass, one load per user (loads=${loads})`);
const pa = await e.sync(A.pid, A.since, undefined, 10), pb = await e.sync(B.pid, B.since, undefined, 10);
ok(pa.length === 2 && pa.some((p) => p.html.includes("a2")), "alice got list + count patches");
ok(pb.length === 0, "bob got nothing: his HTML did not change (unchanged-skip)");
await e.write("other");
ok((await e.sync(A.pid, pa.at(-1).seq, undefined, 10)).length === 0, "writing an unread key renders nothing");
let cross = false; try { await e.sync(A.pid, 0, "bob", 10); } catch { cross = true; }
ok(cross, "a client id can't be used by another user");
e.fragment("note", async ({ read, params }) => html`${await read("items", params.id)}`);
const N = await e.mount("alice", "note", { id: "7" });
await e.write("items:8"); ok((await e.sync(N.pid, N.since, undefined, 10)).length === 0, "write(items:8) doesn't touch a reader of items:7");
e.close();

// --- dev lints ---
const warns = []; const cw = console.warn; console.warn = (m) => warns.push(m);
const lint = defineUi({ name: "lint", load: { x: () => 1 }, writes: { real: ["x"] }, dev: true });
lint.fragment("app", () => html`<button hx-tool="typo">x</button>`);
await lint.render();
console.warn = cw;
ok(warns.some((w) => /hx-tool="typo".*not in defineUi\(\{ writes \}\)/.test(w)), "lint: unknown hx-tool explained with the fix");
let msg = ""; try { await lint.render("nope"); } catch (err) { msg = err.message; } ok(/Unknown fragment "nope". Defined: app/.test(msg), "error: unknown fragment lists defined ones");
const bad = defineUi({ name: "b", load: { x: () => 1 } }); bad.fragment("app", async ({ read }) => html`${await read("y")}`);
msg = ""; try { await bad.render(); } catch (err) { msg = err.message; } ok(/No loader for "y".*Known: x/.test(msg), "error: missing loader names the fix");
console.log(fails ? `\n${fails} FAILED` : "\nall unit checks passed");
process.exit(fails ? 1 : 0);
