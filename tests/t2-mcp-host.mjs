// MCP host mode: real embedded runtime in a DOM, official ext-apps AppBridge as the host.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
const NS = new URL("../examples/notes-server", import.meta.url).pathname;
const { Client } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
const { InMemoryTransport } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`);
const { createServer } = await import(`${NS}/dist/server.js`);
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 15)); } return false; };
const connect = async (n) => { const [a, b] = InMemoryTransport.createLinkedPair(); await createServer().connect(b); const c = new Client({ name: n, version: "1" }); await c.connect(a); return c; };

const agent = await connect("agent"), hostClient = await connect("host");
const uri = (await hostClient.listTools()).tools.find((t) => t.name === "list_notes")._meta.ui.resourceUri;
const res = (await hostClient.readResource({ uri })).contents[0];
const gz = (await import("node:zlib")).gzipSync(res.text).length; ok(gz < 7000, `shell resource is ${gz} bytes gzipped (CSS + runtime)`);

GlobalRegistrator.register({ settings: { disableCSSFileLoading: true } });
document.head.innerHTML = res.text.match(/<head>([\s\S]*?)<\/head>/)[1];
const fakeParent = { postMessage: (m) => queueMicrotask(() => hostSide.onmessage?.(m)) };
Object.defineProperty(window, "parent", { value: fakeParent, configurable: true });
const hostSide = { start: async () => {}, close: async () => {}, send: async (m) => queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { data: m, source: fakeParent }))) };
const bridge = new AppBridge(null, { name: "host", version: "1" }, { serverTools: {} }, {
  hostContext: { theme: "dark", styles: { variables: { "--color-background-primary": "#123456", "--font-sans": "HostSans" } } },
});
bridge.oncalltool = (p) => hostClient.callTool(p);
let init = false; bridge.oninitialized = () => (init = true);
await bridge.connect(hostSide);
(0, eval)(res.text.match(/<script>([\s\S]*)<\/script>/)[1]);

ok(await until(() => init), "handshake with official AppBridge");
ok(await until(() => document.querySelector(".hdr h1")?.textContent === "Notes"), "UI mounted");
const root = document.documentElement;
ok(root.dataset.theme === "dark" && root.style.getPropertyValue("--color-background-primary") === "#123456", "host theme + CSS variables applied");

await agent.callTool({ name: "add_note", arguments: { title: "Live from agent", body: "" } });
ok(await until(() => document.body.textContent.includes("Live from agent")), "agent change → live update");

// typing in the dialog while an update lands: value + focus survive the morph
const input = document.querySelector("#new-note input[name=title]");
input.focus(); input.value = "half-typed";
await agent.callTool({ name: "add_note", arguments: { title: "Second agent note", body: "" } });
ok(await until(() => document.body.textContent.includes("Second agent note")), "second agent change arrived");
const sameInput = document.querySelector("#new-note input[name=title]");
ok(sameInput === input && input.value === "half-typed" && document.activeElement === input, "morph kept the same input node, its value and focus");

// a field the user filled in and left is not wiped by an update either
const body = document.querySelector("#new-note textarea[name=body]");
body.focus();
await agent.callTool({ name: "add_note", arguments: { title: "Third agent note", body: "" } });
ok(await until(() => document.body.textContent.includes("Third agent note")), "third agent change arrived");
ok(input.value === "half-typed", "morph kept a typed value in a field that no longer has focus");
input.value = "";

// view params: typing in the search box re-renders with { q } and the box keeps focus
const q = document.querySelector("input[name=q]");
q.focus(); q.value = "second"; q.dispatchEvent(new Event("input", { bubbles: true }));
ok(await until(() => document.querySelectorAll("#notes-all tbody tr").length === 1), "search box → view params → filtered list");
ok(document.activeElement === q && q.value === "second", "search box kept focus and text");
q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true }));
ok(await until(() => document.querySelectorAll("#notes-all tbody tr").length === 3), "clearing the search restores the list");

// tab selection is client state and survives updates
document.querySelector("#view-1").checked = true;
await agent.callTool({ name: "pin_note", arguments: { id: 1 } });
ok(await until(() => document.querySelector("#notes-pinned tbody")?.textContent.includes("Live from agent")), "pinned tab list updated");
ok(document.querySelector("#view-1").checked, "selected tab survived the update");

// human clicks pin on row 2 in the All tab
const btn = document.querySelector('#notes-all-2 button[hx-tool="pin_note"]');
btn.click();
ok(await until(() => document.querySelector("#notes-all-2")?.textContent.includes("Pinned")), "human click → pin_note → row updated");
ok((await agent.callTool({ name: "list_notes", arguments: {} })).content[0].text.split("\n").slice(0, 2).every((l) => l.includes("(pinned)")), "agent sees both pins");

// form submit through the dialog
const form = document.querySelector("#new-note form");
form.querySelector("[name=title]").value = "Made by a human";
form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const again = new Event("submit", { bubbles: true, cancelable: true }); form.dispatchEvent(again);
ok(again.defaultPrevented, "a second submit while the call is in flight is swallowed, not sent natively");
ok(await until(() => document.querySelector("#notes-all")?.textContent.includes("Made by a human")), "dialog form → add_note → new row");
ok(await until(() => form.querySelector("[name=title]").value === ""), "form reset after success");
const errs = [...document.querySelectorAll("[p-error]")].map((e) => e.tagName + ": " + e.getAttribute("p-error")); ok(!errs.length, "no error states rendered " + errs.join(" | "));

// --- morph on its own: the cases the notes UI cannot reach ---
{
  const { build } = await import("../node_modules/esbuild/lib/main.js");
  const js = (await build({ entryPoints: [new URL("../src/client/morph.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false, logLevel: "silent" })).outputFiles[0].text;
  const { morph } = await import("data:text/javascript," + encodeURIComponent(js));
  const el = (h) => { const t = document.createElement("template"); t.innerHTML = h; return t.content.firstElementChild; };
  const mount = (h) => document.body.appendChild(el(h));

  const list = mount(`<ul><li id="r1">1</li><li id="r2"><input></li><li id="r3">3</li></ul>`), r2 = list.children[1];
  let moves = 0; const ib = list.insertBefore.bind(list); list.insertBefore = (...a) => { moves++; return ib(...a); };
  morph(list, el(`<ul><li id="r2"><input></li><li id="r3">3</li></ul>`));
  ok(moves === 0 && list.children.length === 2 && list.children[0] === r2, "deleting a keyed row moves no other row (focus and open menus survive)");

  const box = mount(`<p><input type="checkbox"></p>`), cb = box.firstElementChild;
  cb.focus(); cb.checked = true;
  morph(box, el(`<p><input type="checkbox" checked></p>`)); morph(box, el(`<p><input type="checkbox"></p>`));
  ok(cb.checked === false, "a focused checkbox still follows a server change");

  const wrap = mount(`<p><input value="a"></p>`), inp = wrap.firstElementChild;
  inp.focus(); inp.value = "typing";
  morph(wrap, el(`<p><input value="server"></p>`));
  const kept = inp.value === "typing";
  inp.blur(); morph(wrap, el(`<p><input value="server"></p>`));
  ok(kept && inp.value === "server", "text under the caret is kept, and the server's value lands once focus has moved on");

  const busy = mount(`<p><button aria-busy="true" p-error="x" data-old="1">b</button></p>`);
  morph(busy, el(`<p><button>b</button></p>`));
  ok(busy.firstElementChild.getAttribute("aria-busy") === "true" && busy.firstElementChild.getAttribute("p-error") === "x" && !busy.firstElementChild.hasAttribute("data-old"), "morph leaves aria-busy and p-error to the runtime");
}

await GlobalRegistrator.unregister();
console.log(fails ? `\n${fails} FAILED` : "\nall MCP host checks passed");
process.exit(fails ? 1 : 0);
