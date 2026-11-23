import json, subprocess, time, urllib.request, sys, os, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get("CHROME_PATH") or shutil.which("google-chrome") or shutil.which("chromium")
from playwright.sync_api import sync_playwright

srv = subprocess.Popen(["node", os.path.join(HERE, "web-server.mjs")], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
assert srv.stdout.readline().strip() == "ready"
fails = 0
def ok(c, m):
    global fails
    print("PASS" if c else "FAIL", m); fails += 0 if c else 1
def agent(name, args={}):
    req = urllib.request.Request("http://localhost:3000/agent", json.dumps({"name": name, "arguments": args}).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))
def http(path, method="GET", headers={}, data=None):
    try:
        r = urllib.request.urlopen(urllib.request.Request("http://localhost:3000" + path, data, headers, method=method)); return r.status
    except urllib.error.HTTPError as e: return e.code

try:
    ok(http("/ui/") == 401, "no session → 401 gate page")
    ok(http("/ui/stream?pid=x") == 401 and http("/ui/tool/add_note", "POST", data=b"{}") == 401, "API without session → 401")

    r = agent("open_notes_in_browser")
    url = r["elicitedUrl"]
    ok(url and "/ui/l/" in url and "Opened notes" in r["content"][0]["text"], "agent tool → URL elicitation sent to client (link not in model text)")
    ok(url not in r["content"][0]["text"], "the link never appears in the tool result the model reads")

    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1040, "height": 760}, device_scale_factor=2)
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(url)
        ok(page.locator("text=Open notes").is_visible(), "GET on link shows Continue page (unfurlers can't burn it)")
        page.screenshot(path=os.path.join(HERE, "shot-gate.png"))
        page.click("text=Continue")
        page.wait_for_selector(".hdr h1")
        ok(page.url.endswith("/ui/"), "POST redeemed link → session cookie → app")
        page.wait_for_function("document.documentElement.hasAttribute('p-ready')")
        ok(page.locator("text=No notes yet").first.is_visible(), "SSR rendered empty state")

        t0 = time.time()
        agent("add_note", {"title": "Ship the UI layer", "body": "Fragments over MCP, no framework"})
        page.wait_for_selector("#notes-all-1", timeout=3000)
        ok(True, f"agent add_note → browser updated over SSE in {int((time.time()-t0)*1000)} ms")
        agent("add_note", {"title": "Write AGENTS.md", "body": "Docs for coding agents"})
        agent("add_note", {"title": "Measure bundle sizes", "body": ""})
        page.wait_for_selector("#notes-all-3")

        page.click('#notes-all-2 button[hx-tool="pin_note"]')
        page.wait_for_selector("#notes-all-2 >> text=Pinned")
        ok("(pinned)" in agent("list_notes")["content"][0]["text"].split("\n")[1], "browser click → tool → agent sees it")

        page.click("text=New note >> nth=0")
        page.wait_for_selector("#new-note:popover-open")
        page.fill("#new-note input[name=title]", "Half typed")
        agent("add_note", {"title": "Agent writes while human types", "body": ""})
        page.wait_for_selector("#notes-all-4")
        ok(page.input_value("#new-note input[name=title]") == "Half typed" and page.evaluate("document.activeElement.name") == "title", "typing + focus survive a live update (real browser)")
        ok(page.locator("#new-note").evaluate("e => e.matches(':popover-open')"), "dialog stayed open through the update")
        page.fill("#new-note input[name=title]", "Created in the browser")
        page.click("#new-note button[type=submit]")
        page.wait_for_selector("text=Created in the browser")
        page.wait_for_function("!document.querySelector('#new-note').matches(':popover-open')")
        ok(True, "dialog form → add_note → row added, dialog closed")

        page.click("label[for=view-1]")
        agent("pin_note", {"id": 3})
        page.wait_for_selector("#notes-pinned-3")
        ok(page.is_checked("#view-1"), "Pinned tab stays selected while it updates live")
        flashed = page.evaluate("[...document.querySelectorAll('#notes-all [p-updated]')].map(e => e.id)")
        ok(flashed == ["notes-all-3"], f"only the changed row is highlighted: {flashed}")
        page.click("label[for=view-0]")

        page.mouse.move(0, 0); page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(HERE, "shot-light.png"), full_page=True)
        page.click("text=New note >> nth=0"); page.wait_for_selector("#new-note:popover-open"); page.fill("#new-note input[name=title]", "Draft…")
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(HERE, "shot-dialog.png"))
        page.keyboard.press("Escape"); page.evaluate("document.activeElement.blur()")
        page.emulate_media(color_scheme="dark"); page.mouse.move(0, 0); page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(HERE, "shot-dark.png"), full_page=True)
        page.emulate_media(color_scheme="light")

        ok(page.goto(url).status == 410, "reusing the link → 410 expired")
        st = page.evaluate("fetch('/ui/tool/add_note',{method:'POST',body:'{}'}).then(r=>r.status)")
        ok(st == 403, "tool POST without P-Req header (cross-site style) → 403")
        page.goto("http://localhost:3000/ui/")
        ok(page.locator("#notes-all-1").count() == 1, "session cookie still valid on reload")
        cookie = [c for c in ctx.cookies() if c["name"] == "p_s"][0]
        ok(cookie["httpOnly"] and cookie["sameSite"] == "Lax" and cookie["path"] == "/ui", "cookie is HttpOnly, SameSite=Lax, path-scoped")
        real = [e for e in errors if not e.startswith("Failed to load resource")]; ok(not real, "no script errors or CSP violations" + ("" if not real else f": {real}"))
        b.close()
finally:
    srv.terminate()
print(f"\n{fails} FAILED" if fails else "\nall web checks passed")
sys.exit(1 if fails else 0)
