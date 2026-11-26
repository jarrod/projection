// The example Worker, run for real: `wrangler dev` (workerd, local D1) and plain HTTP. Nothing here talks to Cloudflare.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "../helpers.ts";

const DIR = new URL("../../examples/cloudflare-worker", import.meta.url).pathname;
const SECRET = "workers-test-secret-".repeat(2);
const env = childEnv({ WRANGLER_SEND_METRICS: "false", CI: "1" });

let port, O, state, child, log = "";
const wrangler = (...a) => [join(DIR, "node_modules/.bin/wrangler"), ...a, "--persist-to", state];

// Starting wrangler can take a while on a cold machine: up to 60 s of waiting for "Ready on".
beforeAll(async () => {
  port = await new Promise((r) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
  O = `http://localhost:${port}`;
  state = mkdtempSync(join(tmpdir(), "projector-workers-"));
  const [bin, ...args] = wrangler("d1", "execute", "DB", "--local", "--file", "schema.sql");
  execFileSync(bin, args, { cwd: DIR, stdio: "pipe", env });
  const [b2, ...a2] = wrangler("dev", "--port", String(port), "--ip", "127.0.0.1", "--var", `UI_SECRET:${SECRET}`, "--var", `UI_ORIGIN:${O}`);
  child = spawn(b2, a2, { cwd: DIR, env });
  child.stdout.on("data", (d) => log += d); child.stderr.on("data", (d) => log += d);
  for (let i = 0; i < 120 && !/Ready on/.test(log); i++) {
    if (child.exitCode !== null) throw new Error("wrangler exited:\n" + log);
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!/Ready on/.test(log)) throw new Error("wrangler did not start:\n" + log);
}, 90_000);
afterAll(() => {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  if (state) rmSync(state, { recursive: true, force: true });
});

let id = 0;
const rpc = async (method, params = {}) => {
  const r = await fetch(`${O}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const t = await r.text();
  const j = JSON.parse(t.startsWith("event:") ? t.split("\n").find((l) => l.startsWith("data:")).slice(5) : t);
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error));
  return j.result;
};
const tool = (name, args = {}) => rpc("tools/call", { name, arguments: args });

describe("1. MCP, stateless, JSON responses", () => {
  test("MCP initialize", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t6", version: "1" } });
    expect(init.serverInfo.name).toBe("notes");
  });
  test("tools/list", async () => {
    const names = (await rpc("tools/list")).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["add_note", "list_notes", "pin_note", "open_notes_in_browser"]));
    expect(names).not.toContain("p_sync");
  });
  test("add_note works (D1)", async () => {
    expect((await tool("add_note", { title: "First note", body: "x" })).content[0].text).toContain("#1");
  });
});

let link, cookie, body, s1;
const post = () => fetch(link, { method: "POST", redirect: "manual", headers: { "sec-fetch-site": "same-origin" } });
const get = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, c = cookie) => fetch(O + path, { redirect: "manual", ...init, headers: { cookie: c, ...init.headers } });
const sync = async (h) => (await get("/ui/sync", { method: "POST", headers: { "P-Req": "1" }, body: JSON.stringify({ h, params: {} }) })).json();

describe("2-3. the link: continue page, redeem once", () => {
  test("open_notes_in_browser returns a link", async () => {
    link = (await tool("open_notes_in_browser")).content.map((c) => c.text).join(" ").match(/https?:\/\/\S+\/ui\/l\/[\w-]+/)?.[0];
    expect(link).toBeTruthy();
    expect(link.startsWith(O)).toBe(true);
  });
  test("GET link shows the Continue page", async () => {
    const page = await fetch(link, { redirect: "manual" });
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/<form/i);
  });
  test("POST redeems: 303 and a p_notes_ui_<port> cookie", async () => {
    const r1 = await post();
    cookie = new RegExp(`p_notes_ui_${port}=[\\w-]+`).exec(r1.headers.get("set-cookie") ?? "")?.[0];
    expect(r1.status).toBe(303);
    expect(cookie).toBeTruthy();
  });
  test("POST again: 410 (claim held in D1 across requests)", async () => {
    expect((await post()).status).toBe(410);
  });
});

describe("4-6. the UI page, sync and a UI action", () => {
  test("GET /ui/ shows the note", async () => {
    const ui = await get("/ui/"); body = await ui.text();
    expect(ui.status).toBe(200);
    expect(body).toContain("First note");
  });
  test('page state has "poll":5000', () => {
    expect(body).toMatch(/"poll":5000/);
  });
  test("sync with the page's hash: no html", async () => {
    const h = /"h":"([^"]+)"/.exec(body)?.[1] ?? "";
    const s0 = await sync(h);
    expect(s0.html).toBeFalsy();
    if (h) expect(s0.h).toBe(h);
    await tool("add_note", { title: "Second note", body: "y" });
    s1 = await sync(s0.h);
  });
  test("sync after an MCP add_note: html has it", () => {
    expect(typeof s1.html).toBe("string");
    expect(s1.html).toContain("Second note");
  });
  test("POST /ui/tool/pin_note ok", async () => {
    const pin = await get("/ui/tool/pin_note", { method: "POST", headers: { "P-Req": "1" }, body: JSON.stringify({ id: 2 }) });
    const pj = await pin.json().catch(() => ({}));
    expect(pin.status).toBe(200);
    expect(pj.error).toBeFalsy();
  });
  test("next sync shows it pinned", async () => {
    const s2 = await sync(s1.h);
    expect(typeof s2.html).toBe("string");
    expect(s2.html).toMatch(/Pinned/);
  });
});

describe("7-8. routing and a tampered cookie", () => {
  test("GET / redirects to /ui/ (302)", async () => {
    const root = await fetch(O + "/", { redirect: "manual" });
    expect(root.status).toBe(302);
    expect(new URL(root.headers.get("location"), O).pathname).toBe("/ui/");
  });
  test("unknown path: 404", async () => {
    expect((await fetch(O + "/nope", { redirect: "manual" })).status).toBe(404);
  });
  test("tampered cookie: 401", async () => {
    expect((await get("/ui/", {}, cookie.slice(0, -4) + (cookie.endsWith("AAAA") ? "BBBB" : "AAAA"))).status).toBe(401);
  });
});
