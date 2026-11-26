// Web mode in a real browser: link → session → live updates → security checks. Uses your installed Chrome (or CHROME_PATH).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { childEnv } from "./child-env.mjs";
const HERE = new URL(".", import.meta.url).pathname, BASE = "http://localhost:3000";

const agent = async (name, args = {}) => (await fetch(BASE + "/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, arguments: args }) })).json();
const status = async (path, init) => (await fetch(BASE + path, { redirect: "manual", ...init })).status;
let srv, browser, ctx, page, url;
const errors = [];

beforeAll(async () => {
  // Not Vitest's env: its DEV would turn on web-server.mjs's dev mode (seed data, /dev sign-in).
  srv = spawn("node", [HERE + "web-server.mjs"], { stdio: ["ignore", "pipe", "inherit"], env: childEnv() });
  await new Promise((res, rej) => { srv.stdout.once("data", (d) => String(d).trim() === "ready" ? res() : rej(new Error(String(d)))); srv.once("exit", () => rej(new Error("web-server.mjs exited: is port 3000 in use?"))); });
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] } : { channel: "chrome" });
  ctx = await browser.newContext({ viewport: { width: 1040, height: 760 } });
  // Pages check every 5 s by default; this test's pages check every 200 ms so it runs quickly.
  await ctx.route("**/ui/", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/"poll":\d+/, '"poll":200') });
  });
  page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
});
afterAll(async () => { await browser?.close(); srv?.kill(); });

describe("before the browser", () => {
  test("no session → 401 gate page", async () => {
    expect(await status("/ui/")).toBe(401);
  });
  test("API without session → 401", async () => {
    expect(await status("/ui/sync", { method: "POST", body: "{}" })).toBe(401);
    expect(await status("/ui/tool/add_note", { method: "POST", body: "{}" })).toBe(401);
  });
  let r;
  test("agent tool → URL elicitation sent to client (link not in model text)", async () => {
    r = await agent("open_notes_in_browser"); url = r.elicitedUrl;
    expect(url).toContain("/ui/l/");
    expect(r.content[0].text).toContain("Opened notes");
  });
  test("the link never appears in the tool result the model reads", () => {
    expect(r.content[0].text).not.toContain(url);
  });
});

describe("a session in the browser", () => {
  test("GET on link shows Continue page (unfurlers can't burn it)", async () => {
    await page.goto(url);
    expect(await page.locator("text=Open notes").isVisible()).toBe(true);
  });
  test("POST redeemed link → session cookie → app", async () => {
    await page.click("text=Continue");
    await page.waitForSelector(".hdr h1");
    expect(page.url()).toMatch(/\/ui\/$/);
  });
  test("the page checks every 5 s by default", async () => {
    expect(await page.locator("#p-state").textContent()).toMatch(/"poll":5000/);
  });
  test("SSR rendered empty state", async () => {
    await page.goto(BASE + "/ui/"); // load it again through the route above (redirects are not routed), for the quick cadence
    await page.waitForFunction("document.documentElement.hasAttribute('p-ready')");
    expect(await page.locator("text=No notes yet").first().isVisible()).toBe(true);
  });
  test("agent add_note → browser updated in under 3 s", async () => {
    const t0 = Date.now();
    await agent("add_note", { title: "Ship the UI layer", body: "Fragments over MCP, no framework" });
    await page.waitForSelector("#notes-all-1", { timeout: 3000 });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  test("browser click → tool → agent sees it", async () => {
    await agent("add_note", { title: "Write AGENTS.md", body: "Docs for coding agents" });
    await agent("add_note", { title: "Measure bundle sizes", body: "" });
    await page.waitForSelector("#notes-all-3");
    await page.click('#notes-all-2 button[hx-tool="pin_note"]');
    await page.waitForSelector("#notes-all-2 >> text=Pinned");
    expect((await agent("list_notes")).content[0].text.split("\n")[1]).toContain("(pinned)");
  });
  test("typing + focus survive a live update (real browser)", async () => {
    await page.click("text=New note >> nth=0");
    await page.waitForSelector("#new-note:popover-open");
    await page.fill("#new-note input[name=title]", "Half typed");
    await agent("add_note", { title: "Agent writes while human types", body: "" });
    await page.waitForSelector("#notes-all-4");
    expect(await page.inputValue("#new-note input[name=title]")).toBe("Half typed");
    expect(await page.evaluate("document.activeElement.name")).toBe("title");
  });
  test("dialog stayed open through the update", async () => {
    expect(await page.locator("#new-note").evaluate((e) => e.matches(":popover-open"))).toBe(true);
  });
  test("dialog form → add_note → one row added, dialog closed, no native submit", async () => {
    await page.fill("#new-note input[name=title]", "Created in the browser");
    // Enter twice: the second lands while the call is in flight and must not submit the form natively.
    await page.press("#new-note input[name=title]", "Enter"); await page.keyboard.press("Enter");
    await page.waitForSelector("text=Created in the browser");
    await page.waitForFunction("!document.querySelector('#new-note').matches(':popover-open')");
    expect(page.url()).toMatch(/\/ui\/$/);
    expect(await page.locator("tr:has-text('Created in the browser')").count()).toBe(1);
  });
  test("Pinned tab stays selected while it updates live", async () => {
    await page.click("label[for=view-1]");
    await agent("pin_note", { id: 3 });
    await page.waitForSelector("#notes-pinned-3");
    expect(await page.isChecked("#view-1")).toBe(true);
  });
  test("only the changed row is highlighted", async () => {
    expect(await page.evaluate("[...document.querySelectorAll('#notes-all [p-updated]')].map(e => e.id)")).toEqual(["notes-all-3"]);
    await page.click("label[for=view-0]");
  });
});

// The cadence: the page state asks for poll: 400 ms here; every /ui/sync is answered at once by the server.
describe("the cadence", () => {
  let p2, slow = false, poll = 400, k;
  const calls = [];
  const gapsOf = (list) => list.slice(1).map((c, i) => c.t - list[i].t);
  const hide = (h) => p2.evaluate((h) => { Object.defineProperty(document, "hidden", { get: () => h, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }, h);
  beforeAll(async () => {
    p2 = await ctx.newPage();
    await p2.route("**/ui/", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()).replace(/"poll":\d+/, `"poll":${poll}`) });
    });
    await p2.route("**/ui/sync", async (route) => {
      calls.push({ t: Date.now() });
      if (slow) await new Promise((r) => setTimeout(r, 700)); // a slow network: the pause still follows each answer
      return route.continue();
    });
  });
  afterAll(async () => { await p2?.close(); });

  test("next check waits the configured poll (400 ms)", async () => {
    await p2.goto(BASE + "/ui/");
    await p2.waitForFunction("document.documentElement.hasAttribute('p-ready')");
    await p2.waitForTimeout(2300);
    const gaps = gapsOf(calls);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(gaps.filter((g) => g < 350 || g > 900), `gaps ${gaps}`).toEqual([]);
  });
  test("own tool call succeeded → checks at once, not at the next tick", async () => {
    await p2.waitForTimeout(150);
    const tc = Date.now();
    await p2.click('#notes-all-1 button[hx-tool="pin_note"]');
    await p2.waitForTimeout(150);
    expect(calls.some((c) => c.t >= tc && c.t - tc < 150)).toBe(true);
  });
  test("hidden tab: no sync calls", async () => {
    await hide(true); await p2.waitForTimeout(100);
    const m = calls.length;
    await p2.click("label[for=view-1]"); // p-set while hidden
    await p2.click('#notes-all-1 button[hx-tool="pin_note"]', { timeout: 1000 }).catch(() => {}); // tool call while hidden
    await p2.waitForTimeout(1500);
    expect(calls.length - m, "sync calls sent while hidden").toBe(0);
  });
  test("visible again → checks at once", async () => {
    k = calls.length; const t1 = Date.now();
    await hide(false);
    await p2.waitForTimeout(250);
    expect(calls.length).toBeGreaterThan(k);
    expect(calls[k].t - t1).toBeLessThan(250);
  });
  test("one poll loop after resume, not two", async () => {
    await p2.waitForTimeout(2000);
    const after = calls.slice(k), g2 = gapsOf(after);
    expect(after.length, "calls in 2.25 s").toBeLessThanOrEqual(7);
    expect(g2.filter((g) => g < 350), `gaps ${g2}`).toEqual([]);
  });
  test("slow answers (700 ms) still pause for poll", async () => {
    slow = true; poll = 1000; await p2.reload(); await p2.waitForTimeout(500);
    const s0 = calls.length; await p2.waitForTimeout(5500);
    const g3 = gapsOf(calls.slice(s0));
    expect(g3.length).toBeGreaterThan(0);
    expect(g3.filter((g) => g < 1600), `gaps ${g3}`).toEqual([]);
  });
});

describe("after the session", () => {
  test("reusing the link → 410 expired", async () => {
    await page.goto(url); // GET never claims, so a used link still shows Continue; pressing it is refused
    const [reuse] = await Promise.all([page.waitForResponse((r) => r.url() === url && r.request().method() === "POST"), page.click("text=Continue")]);
    expect(reuse.status()).toBe(410);
    expect(await page.locator("text=This link has expired").isVisible()).toBe(true);
  });
  test("tool POST without P-Req header (cross-site style) → 403", async () => {
    expect(await page.evaluate("fetch('/ui/tool/add_note',{method:'POST',body:'{}'}).then(r=>r.status)")).toBe(403);
  });
  test("session cookie still valid on reload", async () => {
    await page.goto(BASE + "/ui/");
    expect(await page.locator("#notes-all-1").count()).toBe(1);
  });
  test("cookie is HttpOnly, SameSite=Strict, Path=/ (no __Host- prefix, the port in the name, not Secure, on http://localhost:3000)", async () => {
    const cookie = (await ctx.cookies()).find((c) => c.name === "p_notes_ui_3000");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/", secure: false });
  });
  test("no script errors or CSP violations", () => {
    expect(errors.filter((e) => !e.startsWith("Failed to load resource"))).toEqual([]);
  });
});
