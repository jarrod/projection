// Web mode in a real browser: link → session → live updates → security checks. Uses your installed Chrome (or CHROME_PATH).
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
const HERE = new URL(".", import.meta.url).pathname, BASE = "http://localhost:3000";

const srv = spawn("node", [HERE + "web-server.mjs"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res, rej) => { srv.stdout.once("data", (d) => String(d).trim() === "ready" ? res() : rej(new Error(String(d)))); srv.once("exit", () => rej(new Error("web-server.mjs exited: is port 3000 in use?"))); });
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const agent = async (name, args = {}) => (await fetch(BASE + "/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, arguments: args }) })).json();
const status = async (path, init) => (await fetch(BASE + path, { redirect: "manual", ...init })).status;
let browser;

try {
  ok(await status("/ui/") === 401, "no session → 401 gate page");
  ok(await status("/ui/sync", { method: "POST", body: "{}" }) === 401 && await status("/ui/tool/add_note", { method: "POST", body: "{}" }) === 401, "API without session → 401");

  const r = await agent("open_notes_in_browser"), url = r.elicitedUrl;
  ok(url?.includes("/ui/l/") && r.content[0].text.includes("Opened notes"), "agent tool → URL elicitation sent to client (link not in model text)");
  ok(!r.content[0].text.includes(url), "the link never appears in the tool result the model reads");

  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] } : { channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1040, height: 760 }, deviceScaleFactor: 2 });
  // Pages check every 5 s by default; this test's pages check every 200 ms so it runs quickly.
  await ctx.route("**/ui/", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/"poll":\d+/, '"poll":200') });
  });
  const page = await ctx.newPage(), errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const shot = (name, opts) => page.screenshot({ path: `${HERE}shot-${name}.png`, ...opts });

  await page.goto(url);
  ok(await page.locator("text=Open notes").isVisible(), "GET on link shows Continue page (unfurlers can't burn it)");
  await shot("gate");
  await page.click("text=Continue");
  await page.waitForSelector(".hdr h1");
  ok(page.url().endsWith("/ui/"), "POST redeemed link → session cookie → app");
  ok(/"poll":5000/.test(await page.locator("#p-state").textContent()), "the page checks every 5 s by default");
  await page.goto(BASE + "/ui/"); // load it again through the route above (redirects are not routed), for the quick cadence
  await page.waitForFunction("document.documentElement.hasAttribute('p-ready')");
  ok(await page.locator("text=No notes yet").first().isVisible(), "SSR rendered empty state");

  const t0 = Date.now();
  await agent("add_note", { title: "Ship the UI layer", body: "Fragments over MCP, no framework" });
  await page.waitForSelector("#notes-all-1", { timeout: 3000 });
  ok(Date.now() - t0 < 3000, `agent add_note → browser updated in ${Date.now() - t0} ms`);
  await agent("add_note", { title: "Write AGENTS.md", body: "Docs for coding agents" });
  await agent("add_note", { title: "Measure bundle sizes", body: "" });
  await page.waitForSelector("#notes-all-3");

  await page.click('#notes-all-2 button[hx-tool="pin_note"]');
  await page.waitForSelector("#notes-all-2 >> text=Pinned");
  ok((await agent("list_notes")).content[0].text.split("\n")[1].includes("(pinned)"), "browser click → tool → agent sees it");

  await page.click("text=New note >> nth=0");
  await page.waitForSelector("#new-note:popover-open");
  await page.fill("#new-note input[name=title]", "Half typed");
  await agent("add_note", { title: "Agent writes while human types", body: "" });
  await page.waitForSelector("#notes-all-4");
  ok(await page.inputValue("#new-note input[name=title]") === "Half typed" && await page.evaluate("document.activeElement.name") === "title", "typing + focus survive a live update (real browser)");
  ok(await page.locator("#new-note").evaluate((e) => e.matches(":popover-open")), "dialog stayed open through the update");
  await page.fill("#new-note input[name=title]", "Created in the browser");
  // Enter twice: the second lands while the call is in flight and must not submit the form natively.
  await page.press("#new-note input[name=title]", "Enter"); await page.keyboard.press("Enter");
  await page.waitForSelector("text=Created in the browser");
  await page.waitForFunction("!document.querySelector('#new-note').matches(':popover-open')");
  ok(page.url().endsWith("/ui/") && await page.locator("tr:has-text('Created in the browser')").count() === 1, "dialog form → add_note → one row added, dialog closed, no native submit");

  await page.click("label[for=view-1]");
  await agent("pin_note", { id: 3 });
  await page.waitForSelector("#notes-pinned-3");
  ok(await page.isChecked("#view-1"), "Pinned tab stays selected while it updates live");
  const flashed = await page.evaluate("[...document.querySelectorAll('#notes-all [p-updated]')].map(e => e.id)");
  ok(flashed.join() === "notes-all-3", `only the changed row is highlighted: ${flashed}`);
  await page.click("label[for=view-0]");

  await page.mouse.move(0, 0); await page.waitForTimeout(1000);
  await shot("light", { fullPage: true });
  await page.click("text=New note >> nth=0"); await page.waitForSelector("#new-note:popover-open"); await page.fill("#new-note input[name=title]", "Draft…");
  await page.waitForTimeout(400);
  await shot("dialog");
  await page.keyboard.press("Escape"); await page.evaluate("document.activeElement.blur()");
  await page.emulateMedia({ colorScheme: "dark" }); await page.mouse.move(0, 0); await page.waitForTimeout(500);
  await shot("dark", { fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });

  // The cadence: the page state asks for poll: 400 ms here; every /ui/sync is answered at once by the server.
  {
    const p2 = await ctx.newPage(), calls = [];
    let slow = false, poll = 400;
    await p2.route("**/ui/", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()).replace(/"poll":\d+/, `"poll":${poll}`) });
    });
    await p2.route("**/ui/sync", async (route) => {
      calls.push({ t: Date.now() });
      if (slow) await new Promise((r) => setTimeout(r, 700)); // a slow network: the pause still follows each answer
      return route.continue();
    });
    await p2.goto(BASE + "/ui/");
    await p2.waitForFunction("document.documentElement.hasAttribute('p-ready')");
    await p2.waitForTimeout(2300);
    const gaps = calls.slice(1).map((c, i) => c.t - calls[i].t);
    ok(calls.length >= 4 && gaps.every((g) => g >= 350 && g <= 900), `next check waits the configured poll (400 ms), gaps ${gaps}`);

    await p2.waitForTimeout(150);
    const tc = Date.now();
    await p2.click('#notes-all-1 button[hx-tool="pin_note"]');
    await p2.waitForTimeout(150);
    ok(calls.some((c) => c.t >= tc && c.t - tc < 150), "own tool call succeeded → checks at once, not at the next tick");

    const hide = (h) => p2.evaluate((h) => { Object.defineProperty(document, "hidden", { get: () => h, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }, h);
    await hide(true); await p2.waitForTimeout(100);
    const m = calls.length;
    await p2.click("label[for=view-1]"); // p-set while hidden
    await p2.click('#notes-all-1 button[hx-tool="pin_note"]', { timeout: 1000 }).catch(() => {}); // tool call while hidden
    await p2.waitForTimeout(1500);
    ok(calls.length === m, `hidden tab: no sync calls (${calls.length - m} sent)`);

    const k = calls.length, t1 = Date.now();
    await hide(false);
    await p2.waitForTimeout(250);
    ok(calls.length > k && calls[k].t - t1 < 250, "visible again → checks at once");
    await p2.waitForTimeout(2000);
    const after = calls.slice(k), g2 = after.slice(1).map((c, i) => c.t - after[i].t);
    ok(after.length <= 7 && g2.every((g) => g >= 350), `one poll loop after resume, not two (${after.length} calls in 2.25 s)`);
    slow = true; poll = 1000; await p2.reload(); await p2.waitForTimeout(500);
    const s0 = calls.length; await p2.waitForTimeout(5500);
    const g3 = calls.slice(s0).slice(1).map((c, i) => c.t - calls[s0 + i].t);
    ok(g3.length && g3.every((g) => g >= 1600), `slow answers (700 ms) still pause for poll, gaps ${g3}`);
    await p2.close();
  }

  await page.goto(url); // GET never claims, so a used link still shows Continue; pressing it is refused
  const [reuse] = await Promise.all([page.waitForResponse((r) => r.url() === url && r.request().method() === "POST"), page.click("text=Continue")]);
  ok(reuse.status() === 410 && await page.locator("text=This link has expired").isVisible(), "reusing the link → 410 expired");
  ok(await page.evaluate("fetch('/ui/tool/add_note',{method:'POST',body:'{}'}).then(r=>r.status)") === 403, "tool POST without P-Req header (cross-site style) → 403");
  await page.goto(BASE + "/ui/");
  ok(await page.locator("#notes-all-1").count() === 1, "session cookie still valid on reload");
  const cookie = (await ctx.cookies()).find((c) => c.name === "p_notes_ui_3000");
  ok(cookie?.httpOnly && cookie.sameSite === "Strict" && cookie.path === "/" && !cookie.secure, "cookie is HttpOnly, SameSite=Strict, Path=/ (no __Host- prefix, the port in the name, not Secure, on http://localhost:3000)");
  const real = errors.filter((e) => !e.startsWith("Failed to load resource"));
  ok(!real.length, "no script errors or CSP violations" + (real.length ? `: ${real}` : ""));
} catch (e) { ok(false, e.message.split("\n")[0]); }
finally { await browser?.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : "\nall web checks passed");
process.exit(fails ? 1 : 0);
