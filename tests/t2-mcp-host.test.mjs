// MCP host mode: real embedded runtime in a DOM, official ext-apps AppBridge as the host.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
const NS = new URL("../examples/notes-server", import.meta.url).pathname;
const { Client } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
const { InMemoryTransport } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`);
const { createServer } = await import(`${NS}/dist/server.js`);
// The DOM updates asynchronously: retry until it holds, for up to 3 s.
const eventually = (fn) => expect.poll(fn, { timeout: 3000, interval: 15 });
const connect = async (n) => { const [a, b] = InMemoryTransport.createLinkedPair(); await createServer().connect(b); const c = new Client({ name: n, version: "1" }); await c.connect(a); return c; };

let agent, hostClient, res, init = false;
// The DOM is registered only after the Node-side MCP clients exist, as the host would have them.
beforeAll(async () => {
  agent = await connect("agent"); hostClient = await connect("host");
  const uri = (await hostClient.listTools()).tools.find((t) => t.name === "list_notes")._meta.ui.resourceUri;
  res = (await hostClient.readResource({ uri })).contents[0];

  GlobalRegistrator.register({ settings: { disableCSSFileLoading: true } });
  document.head.innerHTML = res.text.match(/<head>([\s\S]*?)<\/head>/)[1];
  document.body.innerHTML = '<script type="application/json" id="p-state">{"poll":50}</script>'; // check often, so the test is quick
  const fakeParent = { postMessage: (m) => queueMicrotask(() => hostSide.onmessage?.(m)) };
  Object.defineProperty(window, "parent", { value: fakeParent, configurable: true });
  const hostSide = { start: async () => {}, close: async () => {}, send: async (m) => queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { data: m, source: fakeParent }))) };
  const bridge = new AppBridge(null, { name: "host", version: "1" }, { serverTools: {} }, {
    hostContext: { theme: "dark", styles: { variables: { "--color-background-primary": "#123456", "--font-sans": "HostSans" } } },
  });
  bridge.oncalltool = (p) => hostClient.callTool(p);
  bridge.oninitialized = () => (init = true);
  await bridge.connect(hostSide);
  (0, eval)(res.text.match(/<script>([\s\S]*)<\/script>/)[1]);
});
afterAll(async () => { await GlobalRegistrator.unregister(); });

describe("embedded runtime with the official AppBridge", () => {
  test("shell resource is under 7000 bytes gzipped (CSS + runtime)", async () => {
    expect((await import("node:zlib")).gzipSync(res.text).length).toBeLessThan(7000);
  });
  test("the shell tells the runtime to check every 5 s by default", () => {
    expect(res.text).toMatch(/id="p-state">\{"poll":5000\}</);
  });
  test("handshake with official AppBridge", async () => {
    await eventually(() => init).toBe(true);
  });
  test("UI mounted", async () => {
    await eventually(() => document.querySelector(".hdr h1")?.textContent).toBe("Notes");
  });
  test("host theme + CSS variables applied", () => {
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("--color-background-primary")).toBe("#123456");
  });
  test("agent change → live update", async () => {
    await agent.callTool({ name: "add_note", arguments: { title: "Live from agent", body: "" } });
    await eventually(() => document.body.textContent).toContain("Live from agent");
  });

  // typing in the dialog while an update lands: value + focus survive the morph
  let input;
  test("second agent change arrived", async () => {
    input = document.querySelector("#new-note input[name=title]");
    input.focus(); input.value = "half-typed";
    await agent.callTool({ name: "add_note", arguments: { title: "Second agent note", body: "" } });
    await eventually(() => document.body.textContent).toContain("Second agent note");
  });
  test("morph kept the same input node, its value and focus", () => {
    expect(document.querySelector("#new-note input[name=title]")).toBe(input);
    expect(input.value).toBe("half-typed");
    expect(document.activeElement).toBe(input);
  });

  // a field the user filled in and left is not wiped by an update either
  test("third agent change arrived", async () => {
    document.querySelector("#new-note textarea[name=body]").focus();
    await agent.callTool({ name: "add_note", arguments: { title: "Third agent note", body: "" } });
    await eventually(() => document.body.textContent).toContain("Third agent note");
  });
  test("morph kept a typed value in a field that no longer has focus", () => {
    expect(input.value).toBe("half-typed");
    input.value = "";
  });

  // view params: typing in the search box re-renders with { q } and the box keeps focus
  let q;
  test("search box → view params → filtered list", async () => {
    q = document.querySelector("input[name=q]");
    q.focus(); q.value = "second"; q.dispatchEvent(new Event("input", { bubbles: true }));
    await eventually(() => document.querySelectorAll("#notes-all tbody tr").length).toBe(1);
  });
  test("search box kept focus and text", () => {
    expect(document.activeElement).toBe(q);
    expect(q.value).toBe("second");
  });
  test("clearing the search restores the list", async () => {
    q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true }));
    await eventually(() => document.querySelectorAll("#notes-all tbody tr").length).toBe(3);
  });

  // tab selection is client state and survives updates
  test("pinned tab list updated", async () => {
    document.querySelector("#view-1").checked = true;
    await agent.callTool({ name: "pin_note", arguments: { id: 1 } });
    await eventually(() => document.querySelector("#notes-pinned tbody")?.textContent ?? "").toContain("Live from agent");
  });
  test("selected tab survived the update", () => {
    expect(document.querySelector("#view-1").checked).toBe(true);
  });

  // human clicks pin on row 2 in the All tab
  test("human click → pin_note → row updated", async () => {
    document.querySelector('#notes-all-2 button[hx-tool="pin_note"]').click();
    await eventually(() => document.querySelector("#notes-all-2")?.textContent ?? "").toContain("Pinned");
  });
  test("agent sees both pins", async () => {
    const lines = (await agent.callTool({ name: "list_notes", arguments: {} })).content[0].text.split("\n").slice(0, 2);
    for (const l of lines) expect(l).toContain("(pinned)");
  });

  // form submit through the dialog
  let form;
  test("a second submit while the call is in flight is swallowed, not sent natively", () => {
    form = document.querySelector("#new-note form");
    form.querySelector("[name=title]").value = "Made by a human";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const again = new Event("submit", { bubbles: true, cancelable: true }); form.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(true);
  });
  test("dialog form → add_note → new row", async () => {
    await eventually(() => document.querySelector("#notes-all")?.textContent ?? "").toContain("Made by a human");
  });
  test("form reset after success", async () => {
    await eventually(() => form.querySelector("[name=title]").value).toBe("");
  });
  test("no error states rendered", () => {
    expect([...document.querySelectorAll("[p-error]")].map((e) => e.tagName + ": " + e.getAttribute("p-error"))).toEqual([]);
  });
});

describe("morph on its own: the cases the notes UI cannot reach", () => {
  let morph;
  const el = (h) => { const t = document.createElement("template"); t.innerHTML = h; return t.content.firstElementChild; };
  const mount = (h) => document.body.appendChild(el(h));
  beforeAll(async () => {
    const { build } = await import("../node_modules/esbuild/lib/main.js");
    const js = (await build({ entryPoints: [new URL("../src/client/morph.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false, logLevel: "silent" })).outputFiles[0].text;
    ({ morph } = await import(/* @vite-ignore */ "data:text/javascript," + encodeURIComponent(js)));
  });

  test("deleting a keyed row moves no other row (focus and open menus survive)", () => {
    const list = mount(`<ul><li id="r1">1</li><li id="r2"><input></li><li id="r3">3</li></ul>`), r2 = list.children[1];
    let moves = 0; const ib = list.insertBefore.bind(list); list.insertBefore = (...a) => { moves++; return ib(...a); };
    morph(list, el(`<ul><li id="r2"><input></li><li id="r3">3</li></ul>`));
    expect(moves).toBe(0);
    expect(list.children.length).toBe(2);
    expect(list.children[0]).toBe(r2);
  });
  test("a focused checkbox still follows a server change", () => {
    const box = mount(`<p><input type="checkbox"></p>`), cb = box.firstElementChild;
    cb.focus(); cb.checked = true;
    morph(box, el(`<p><input type="checkbox" checked></p>`)); morph(box, el(`<p><input type="checkbox"></p>`));
    expect(cb.checked).toBe(false);
  });
  test("text under the caret is kept, and the server's value lands once focus has moved on", () => {
    const wrap = mount(`<p><input value="a"></p>`), inp = wrap.firstElementChild;
    inp.focus(); inp.value = "typing";
    morph(wrap, el(`<p><input value="server"></p>`));
    expect(inp.value).toBe("typing");
    inp.blur(); morph(wrap, el(`<p><input value="server"></p>`));
    expect(inp.value).toBe("server");
  });
  test("morph leaves aria-busy and p-error to the runtime", () => {
    const busy = mount(`<p><button aria-busy="true" p-error="x" data-old="1">b</button></p>`);
    morph(busy, el(`<p><button>b</button></p>`));
    expect(busy.firstElementChild.getAttribute("aria-busy")).toBe("true");
    expect(busy.firstElementChild.getAttribute("p-error")).toBe("x");
    expect(busy.firstElementChild.hasAttribute("data-old")).toBe(false);
  });
});
