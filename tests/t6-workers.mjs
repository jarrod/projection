// The example Worker, run for real: `wrangler dev` (workerd, local D1) and plain HTTP. Nothing here talks to Cloudflare.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = new URL("../examples/cloudflare-worker", import.meta.url).pathname;
const SECRET = "workers-test-secret-".repeat(2);
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };

const port = await new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const O = `http://localhost:${port}`;
const state = mkdtempSync(join(tmpdir(), "projector-workers-"));
const wrangler = (...a) => [join(DIR, "node_modules/.bin/wrangler"), ...a, "--persist-to", state];
let child, log = "";
const stop = () => { if (child && child.exitCode === null) child.kill("SIGTERM"); };
process.on("exit", stop);

try {
  const [bin, ...args] = wrangler("d1", "execute", "DB", "--local", "--file", "schema.sql");
  execFileSync(bin, args, { cwd: DIR, stdio: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
  const [b2, ...a2] = wrangler("dev", "--port", String(port), "--ip", "127.0.0.1", "--var", `UI_SECRET:${SECRET}`, "--var", `UI_ORIGIN:${O}`);
  child = spawn(b2, a2, { cwd: DIR, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
  child.stdout.on("data", (d) => log += d); child.stderr.on("data", (d) => log += d);
  for (let i = 0; i < 120 && !/Ready on/.test(log); i++) {
    if (child.exitCode !== null) throw new Error("wrangler exited:\n" + log);
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!/Ready on/.test(log)) throw new Error("wrangler did not start:\n" + log);

  // 1. MCP, stateless, JSON responses
  let id = 0;
  const rpc = async (method, params = {}) => {
    const r = await fetch(`${O}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const t = await r.text();
    const j = JSON.parse(t.startsWith("event:") ? t.split("\n").find((l) => l.startsWith("data:")).slice(5) : t);
    if (j.error) throw new Error(method + ": " + JSON.stringify(j.error));
    return j.result;
  };
  const tool = (name, args = {}) => rpc("tools/call", { name, arguments: args });
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t6", version: "1" } });
  ok(init.serverInfo.name === "notes", "MCP initialize");
  const names = (await rpc("tools/list")).tools.map((t) => t.name);
  ok(["add_note", "list_notes", "pin_note", "open_notes_in_browser"].every((n) => names.includes(n)) && !names.includes("p_sync"), `tools/list: ${names.join(", ")}`);
  ok((await tool("add_note", { title: "First note", body: "x" })).content[0].text.includes("#1"), "add_note works (D1)");

  // 2. the link
  const link = (await tool("open_notes_in_browser")).content.map((c) => c.text).join(" ").match(/https?:\/\/\S+\/ui\/l\/[\w-]+/)?.[0];
  ok(!!link && link.startsWith(O), "open_notes_in_browser returns a link");

  // 3. continue page, redeem once
  const page = await fetch(link, { redirect: "manual" });
  ok(page.status === 200 && /<form/i.test(await page.text()), "GET link shows the Continue page");
  const post = () => fetch(link, { method: "POST", redirect: "manual", headers: { "sec-fetch-site": "same-origin" } });
  const r1 = await post();
  const cookie = new RegExp(`p_notes_ui_${port}=[\\w-]+`).exec(r1.headers.get("set-cookie") ?? "")?.[0];
  ok(r1.status === 303 && !!cookie, "POST redeems: 303 and a p_notes_ui_<port> cookie");
  ok((await post()).status === 410, "POST again: 410 (claim held in D1 across requests)");

  // 4. the UI page
  const get = (path, init = {}, c = cookie) => fetch(O + path, { redirect: "manual", ...init, headers: { cookie: c, ...init.headers } });
  const ui = await get("/ui/"), body = await ui.text();
  ok(ui.status === 200 && body.includes("First note"), "GET /ui/ shows the note");
  ok(/"poll":5000/.test(body), 'page state has "poll":5000');

  // 5. sync
  const h = /"h":"([^"]+)"/.exec(body)?.[1] ?? "";
  const sync = async (h) => (await get("/ui/sync", { method: "POST", headers: { "P-Req": "1" }, body: JSON.stringify({ h, params: {} }) })).json();
  const s0 = await sync(h);
  ok(!s0.html && (!h || s0.h === h), `sync with the page's hash: no html (hash ${h || "none in page"})`);
  await tool("add_note", { title: "Second note", body: "y" });
  const s1 = await sync(s0.h);
  ok(typeof s1.html === "string" && s1.html.includes("Second note"), "sync after an MCP add_note: html has it");

  // 6. a UI action
  const pin = await get("/ui/tool/pin_note", { method: "POST", headers: { "P-Req": "1" }, body: JSON.stringify({ id: 2 }) });
  const pj = await pin.json().catch(() => ({}));
  ok(pin.status === 200 && !pj.error, `POST /ui/tool/pin_note ok (${pin.status})`);
  const s2 = await sync(s1.h);
  ok(typeof s2.html === "string" && /Pinned/.test(s2.html), "next sync shows it pinned");

  // 7. routing: / goes to the UI, anything else is a 404 (not a crash)
  const root = await fetch(O + "/", { redirect: "manual" });
  ok(root.status === 302 && new URL(root.headers.get("location"), O).pathname === "/ui/", `GET / redirects to /ui/ (${root.status})`);
  const nf = await fetch(O + "/nope", { redirect: "manual" });
  ok(nf.status === 404, `unknown path: ${nf.status}`);

  // 8. tampered cookie
  const bad = await get("/ui/", {}, cookie.slice(0, -4) + (cookie.endsWith("AAAA") ? "BBBB" : "AAAA"));
  ok(bad.status === 401, `tampered cookie: ${bad.status}`);
} catch (e) {
  ok(false, "test run: " + (e?.stack ?? e));
  if (log) console.log("--- wrangler log (tail) ---\n" + log.split("\n").slice(-30).join("\n"));
} finally {
  stop();
  rmSync(state, { recursive: true, force: true });
}
process.exit(fails ? 1 : 0);
