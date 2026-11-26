// The same behaviour on both protocols of SDK v2: 2025-era (a connection, capabilities from initialize) and
// 2026-07-28 (a server per request, each request carrying its client's capabilities).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { McpServer, createMcpHandler, inputRequired } from "@modelcontextprotocol/server";
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
const err = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };
const APPS = { extensions: { "io.modelcontextprotocol/ui": {} } }, URLS = { elicitation: { url: {} } };
const textOf = (r) => r.content?.[0]?.text ?? "";
const linkIn = (r) => textOf(r).match(/http\S+/)?.[0];
const lib = { ...await import("../dist/index.js"), ...await import("../dist/testing.js") };

const inMemory = async (make, { capabilities = {}, authInfo, onElicit } = {}) => {
  const [a, b] = InMemoryTransport.createLinkedPair(), send = a.send.bind(a);
  a.send = (m, o) => send(m, { ...o, authInfo });
  await make().connect(b);
  const c = new Client({ name: "c", version: "1" }, { capabilities });
  onElicit?.(c);
  await c.connect(a);
  return c;
};
// A server per request, over HTTP, where each request carries its client's capabilities.
const http = async (make, { capabilities = {}, authInfo, host = "localhost" } = {}) => {
  const handler = createMcpHandler(make), base = `http://${host}/mcp`;
  const c = new Client({ name: "c", version: "1" }, { capabilities, versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await c.connect(new StreamableHTTPClientTransport(new URL(base), { fetch: (u, i) => handler.fetch(new Request(u, i), { authInfo }) }));
  return c;
};
// The server's MCP endpoint in process: stateless, given the authInfo its own bearer check found.
const endpoint = (make, check) => async (req) => {
  const authInfo = check(req); if (!authInfo) return new Response(null, { status: 401 });
  return createMcpHandler(make).fetch(req, { authInfo });
};
const setup = (modern) => async () => ({ McpServer, endpoint, inputRequired, lib, onElicit: (c, h) => c.setRequestHandler("elicitation/create", h),
  shape: (s) => z.object(s), connect: modern ? http : inMemory, auth: (authInfo) => ({ http: { authInfo } }),
  req: (headers) => ({ http: { req: new Request("http://localhost/mcp", { headers }) } }) });

// modern decides which checks apply, so it is known before setup runs.
for (const [label, setup_, modern] of [
  ["server 2.4, 2025 protocol", setup(false), false], ["server 2.4, 2026-07-28", setup(true), true],
]) describe(label, () => {
  let S, defineUi, html, testUi, ui, c, app, alice, last, server, seen;
  const db = {};
  // The endpoint's bearer check: "t" is u1's token.
  const check = (req) => req.headers.get("authorization") === "Bearer t" && { token: "t", clientId: "app", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 60, extra: { sub: "u1" } };
  const make = () => {
    const s = server = ui.attach(new S.McpServer({ name: "t", version: "1" }));
    const tool = (name, cfg, h) => s.registerTool(name, { description: name, ...cfg }, h);
    tool("add", { inputSchema: S.shape({ item: z.string() }) }, async ({ item }, extra) => { (db[ui.identify(extra)] ??= []).push(item); return { content: [{ type: "text", text: "added" }] }; });
    tool("raw", { inputSchema: { n: z.coerce.number() } }, async ({ n }) => ({ content: [{ type: "text", text: "n=" + (n + 1) }] }));
    tool("look", { annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: "text", text: "seen" }] }));
    tool("ctx", {}, async (extra) => { last = extra; return { content: [{ type: "text", text: ui.identify(extra) }] }; });
    tool("elicit", {}, async (extra) => { await extra.mcpReq.elicitInput({ message: "m", requestedSchema: { type: "object", properties: {} } }); return { content: [] }; });
    tool("ask", {}, async () => S.inputRequired({ inputRequests: { x: S.inputRequired.elicitUrl({ message: "m", url: "http://localhost/" }) } }));
    return s;
  };
  const sub = { token: "t", clientId: "app", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 60, extra: { sub: "u1" } };
  const p = async (args, o) => (await app.callTool({ name: "p_sync", arguments: args }, o)).structuredContent;
  const elicit = (action) => S.connect(make, { capabilities: URLS, onElicit: (cl) => S.onElicit(cl, async (r) => { seen = r.params; if (!action) throw new Error("gave up"); return { action }; }) });

  beforeAll(async () => {
    S = await setup_(); ({ defineUi, html, testUi } = S.lib);
    ui = defineUi({ name: "t", attachTo: ["look"], web: { origin: "http://localhost:3912", secret: "test-secret-test-secret-test-secret-0123", mcp: S.endpoint(() => make(), check) }, view: async ({ user, params, call }) => html`<p>${user}: ${(db[user] ?? []).join()} ${params.q}</p><i>${(await call("look")).content?.[0]?.text}</i>` });
    c = await S.connect(make);
  });
  afterAll(() => { ui?.site.close(); });

  // tools/list
  test("a plain client sees the server's tools and open_t_in_browser, not p_sync", async () => {
    expect((await c.listTools()).tools.map((t) => t.name)).toEqual(["open_t_in_browser", "add", "raw", "look", "ctx", "elicit", "ask"]);
  });
  test("attachTo adds _meta.ui.resourceUri to that tool only", async () => {
    const tools = (await c.listTools()).tools, named = (n) => tools.find((t) => t.name === n);
    expect(named("look")._meta.ui.resourceUri).toBe("ui://t/app.html");
    expect(named("add")._meta).toBeFalsy();
  });
  test("an MCP Apps client lists p_sync, app-only, with its schema", async () => {
    app = await S.connect(make, { capabilities: APPS });
    const sync = (await app.listTools()).tools.find((t) => t.name === "p_sync");
    expect(sync?._meta.ui.visibility[0]).toBe("app");
    expect(Object.keys(sync.inputSchema.properties)).toEqual(["params", "h"]);
  });
  test("the UI resource is served", async () => {
    expect((await app.readResource({ uri: "ui://t/app.html" })).contents[0].text).toMatch(/^<!doctype html>/);
  });

  // p_sync: one check, answered at once
  let first, at;
  test("p_sync renders for the user and their params", async () => {
    first = await p({ params: { q: "<b>" } });
    at = { h: first.h, params: { q: "<b>" } };
    expect(first.html).toContain("local:  &lt;b&gt;");
  });
  test("the view reads through call(), via this SDK's tools/call handler", () => {
    expect(first.html).toContain("<i>seen</i>");
  });
  test("p_sync rejects params that are not an object", async () => {
    expect(textOf(await app.callTool({ name: "p_sync", arguments: { params: "x" } }))).toMatch(/Invalid/);
  });
  test("nothing changed: p_sync answers at once, with no HTML", async () => {
    const t0 = Date.now(), r = await p(at), ms = Date.now() - t0;
    expect(r.html).toBeFalsy();
    expect(ms).toBeLessThan(1000);
  });
  test("after a change the next check sends the new HTML", async () => {
    await c.callTool({ name: "add", arguments: { item: "one" } });
    expect((await p(at)).html).toContain("one");
  });
  test("a tool with a raw zod shape still validates and coerces", async () => {
    expect(textOf(await c.callTool({ name: "raw", arguments: { n: "1" } }))).toBe("n=2");
  });

  // identity
  test("no auth is the local user", async () => {
    expect(textOf(await c.callTool({ name: "ctx", arguments: {} }))).toBe("local");
  });
  test("the user is the token's subject", async () => {
    alice = await S.connect(make, { authInfo: sub });
    expect(textOf(await alice.callTool({ name: "ctx", arguments: {} }))).toBe("u1");
  });
  test("p_sync renders for that user", async () => {
    expect((await alice.callTool({ name: "p_sync", arguments: {} })).structuredContent.html).toContain("u1:");
  });
  test("authenticated with no subject is refused everywhere, never the shared user", async () => {
    const nobody = await S.connect(make, { authInfo: { ...sub, extra: {} } });
    for (const name of ["ctx", "p_sync", "open_t_in_browser"]) {
      const r = await nobody.callTool({ name, arguments: {} });
      expect(r.isError, name).toBe(true);
      expect(textOf(r), name).toMatch(/No user id/);
    }
  });
  test("ui.identify throws too", async () => {
    expect(await err(() => ui.identify(S.auth({ clientId: "app" })))).toMatch(/No user id/);
  });
  test("a custom identify gets what the SDK passes to handlers", async () => {
    let given; const custom = defineUi({ name: "c", web: false, identify: (x) => (given = x, "me"), view: () => html`x` });
    const cs = await S.connect(() => custom.attach(new S.McpServer({ name: "c", version: "1" })), { authInfo: sub });
    await cs.callTool({ name: "p_sync", arguments: {} });
    expect(given.http.authInfo.extra.sub).toBe("u1");
    expect(given.mcpReq.method).toBe("tools/call");
  });

  // open in browser, and the browser session's tool calls
  let post;
  test("without URL elicitation the link comes back as text", async () => {
    const opened = await alice.callTool({ name: "open_t_in_browser", arguments: {} }), link = linkIn(opened);
    expect(textOf(opened)).toMatch(/Share this private link/);
    expect(link).toMatch(/^http:\/\/localhost:3912\/ui\/l\//);
    const cookie = (await ui.site.fetch(new Request(link, { method: "POST" }))).headers.get("set-cookie").split(";")[0];
    post = async (name, body = {}) => { const r = await ui.site.fetch(new Request("http://localhost:3912/ui/tool/" + name, { method: "POST", headers: { cookie, "P-Req": "1" }, body: JSON.stringify(body) })); return { status: r.status, text: await r.text() }; };
  });
  test("a browser tool call runs as the user who opened it", async () => {
    expect((await post("add", { item: "web" })).text).toMatch(/added/);
    expect(db.u1.join()).toBe("web");
  });
  test("its arguments go through the tool's own schema", async () => {
    expect((await post("add", { item: {} })).status).toBe(400);
  });
  test("its context is a real request's, with the auth the endpoint checked and the real token", async () => {
    await post("ctx");
    expect(last.http.authInfo.extra.sub).toBe("u1");
    expect(last.http.authInfo.token).toBe("t");
    expect(last.http.req).toBeInstanceOf(Request);
  });
  test("its context has the full shape", () => {
    const m = last.mcpReq ?? {};
    expect(m.method).toBe("tools/call");
    expect(m.id).toBeTruthy();
    expect(m.signal).toBeInstanceOf(AbortSignal);
    expect(m.requestState()).toBeUndefined();
    expect(m.inputResponses).toBeUndefined();
  });
  test("a tool that needs the client's input fails from the browser instead of looking done", async () => {
    const asked = await post("ask");
    expect(asked.status).toBeGreaterThanOrEqual(400);
    expect(asked.text).not.toContain("input_required");
  });
  test("a tool that asks the client from a browser call fails at once, it does not wait for an answer", async () => {
    const t0 = Date.now(), asked = await post("elicit"), ms = Date.now() - t0;
    expect(asked.status).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThan(2000);
  });
  test("a browser session cannot mint itself a new link", async () => {
    const again = await post("open_t_in_browser");
    expect(again.status).toBe(400);
    expect(again.text).toMatch(/Not available/);
    expect(again.text).not.toMatch(/\/ui\/l\//);
  });
  test("nor with a copy of its context", async () => {
    expect(await err(() => ui.link(last, server))).toMatch(/Not available/);
    expect(await err(() => ui.link({ ...last }, server))).toMatch(/Not available/);
  });

  // elicitation
  if (modern) {
    test("a protocol where the server cannot ask: the link comes back as text", async () => {
      const r = await (await elicit("accept")).callTool({ name: "open_t_in_browser", arguments: {} });
      expect(linkIn(r)).toBeTruthy();
      expect(r.isError).toBeFalsy();
    });
  } else {
    test("URL elicitation is sent to the client and accepted", async () => {
      const yes = await (await elicit("accept")).callTool({ name: "open_t_in_browser", arguments: {} });
      expect(textOf(yes)).toMatch(/^Opened t/);
      expect(seen.mode).toBe("url");
      expect(seen.url).toMatch(/\/ui\/l\//);
      expect(seen.elicitationId).toBeTruthy();
    });
    test("a declined elicitation is reported, with no link", async () => {
      expect(textOf(await (await elicit("decline")).callTool({ name: "open_t_in_browser", arguments: {} }))).toMatch(/declined/);
    });
    test("a failed elicitation hands back the link", async () => {
      expect(linkIn(await (await elicit()).callTool({ name: "open_t_in_browser", arguments: {} }))).toBeTruthy();
    });
  }

  // remote user, no origin
  describe("remote user, no origin", () => {
    let local, ls;
    const from = (host) => err(() => local.openInBrowser(S.req({ host }), { server: ls }));
    beforeAll(() => { local = defineUi({ name: "l", view: () => html`x` }); ls = local.attach(new S.McpServer({ name: "l", version: "1" })); });
    afterAll(() => { local?.site.close(); });
    test("a remote request with no origin is refused; a loopback one is not", async () => {
      expect(await from("app.example.com")).toMatch(/web\.origin/);
      expect(await from("localhost:8080")).toBe("");
    });
    if (modern) test("the same from a real request, by its URL when there is no Host header", async () => {
      const make2 = () => local.attach(new S.McpServer({ name: "l", version: "1" }));
      const call = async (host) => textOf(await (await S.connect(make2, { host })).callTool({ name: "open_l_in_browser", arguments: {} }));
      expect(await call("app.example.com")).toMatch(/web\.origin/);
      expect(await call("localhost")).toMatch(/127\.0\.0\.1/);
    });
  });

  // registration styles and order
  describe("registration styles and order", () => {
    let low, lows, lc;
    beforeAll(async () => {
      low = defineUi({ name: "low", web: false, view: () => html`x` }); lows = low.attach(new S.McpServer({ name: "low", version: "1" }));
      {
        const any = z.object({ name: z.string() }).loose();
        lows.server.setRequestHandler("tools/call", { params: any }, async (params) => ({ content: [{ type: "text", text: "got " + params.name }] }));
        lows.server.setRequestHandler("custom/hi", { params: z.object({ a: z.number() }), result: z.any() }, async ({ a }) => ({ a }));
        lc = await S.connect(() => lows);
      }
    });
    test("the three-argument setRequestHandler works", async () => {
      expect(textOf(await lc.callTool({ name: "anything", arguments: {} }))).toBe("got anything");
    });
    if (!modern) test("a custom method is left alone", async () => {
      expect((await lc.request({ method: "custom/hi", params: { a: 1 } }, z.object({ a: z.number() }))).a).toBe(1);
    });
    test("attach after registerTool fails loudly", async () => {
      const late = new S.McpServer({ name: "late", version: "1" });
      late.registerTool("x", { description: "x" }, async () => ({ content: [] }));
      expect(await err(() => low.attach(late))).toMatch(/before any tool is registered/);
    });
    test("attach twice fails loudly", async () => {
      expect(await err(() => low.attach(lows))).toMatch(/already called/);
    });
  });

  // the test harness
  test("testUi drives the server: agent call, live update, click", async () => {
    const t = await testUi(make), v = await t.mount();
    try {
      await t.agent.callTool({ name: "add", arguments: { item: "two" } });
      await v.until((s) => s.includes("two"));
      await v.click("add", { item: "three" });
      expect(v.text()).toContain("three");
      expect(t.resourceUri).toBe("ui://t/app.html");
    } finally { v.close(); await t.close(); }
  });
});
