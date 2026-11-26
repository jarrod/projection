// Web sign-in with nothing kept on the server: links and session cookies are sealed, and hold the agent's bearer token;
// single use is web.claim. Every browser request goes to the server's own MCP endpoint (here in process) with that token.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { defineUi, html } from "mcp-projector";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { err } from "./helpers.ts";
import http from "node:http";

const O = "https://s.test", SECRET = "test-secret-".repeat(4), now = Date.now;
let skew = 0; Date.now = () => now() + skew; // a clock the tests can move
afterAll(() => { Date.now = now; });
/** Run fn with the clock moved ms ahead; it always moves back, even when a check fails. */
const later = async (ms, fn) => { skew = ms; try { return await fn(); } finally { skew = 0; } };
const db: Record<string, string[]> = {}, seen: any[] = [];
const as = (sub, more = {}) => ({ http: { authInfo: { token: "bearer-" + sub, clientId: "app", scopes: [], extra: { sub }, ...more } } });

/** The server's MCP endpoint: stateless, with its own bearer check ("bearer-<sub>" is that user's token). */
const endpoint = (make) => async (req) => {
  const m = /^Bearer (bearer-(\w+))$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return new Response(null, { status: 401 });
  return createMcpHandler(make).fetch(req, { authInfo: { token: m[1], clientId: "app", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600, extra: { sub: m[2] } } });
};
/** One app: a ui and a server factory, as a serverless integrator would write them. */
const app = ({ name = "s", web = {} }: { name?: string; web?: Record<string, any> } = {}) => {
  const a: any = {};
  a.ui = defineUi({ name, web: { origin: O, secret: SECRET, mcp: endpoint(() => a.make()), ...web },
    view: async ({ user, call }) => html`<p>${user}: ${(await call("mine")).content[0].text}</p>` });
  a.make = () => {
    const s = a.ui.attach(new McpServer({ name, version: "1" }));
    const sub = (x) => x.http?.authInfo?.extra?.sub ?? "local";
    s.registerTool("mine", { description: "read", annotations: { readOnlyHint: true } }, async (x) => ({ content: [{ type: "text", text: (db[sub(x)] ?? []).join() || "none" }] }));
    s.registerTool("add", { description: "write" }, async (x) => { seen.push(x.http?.authInfo); (db[sub(x)] ??= []).push(name); return { content: [{ type: "text", text: "added" }] }; });
    return s;
  };
  const site = a.ui.site, o = web.origin ?? O;
  a.ck = o.startsWith("https:") ? "__Host-" + `p_${name}${web.base ?? "/ui"}`.replace(/\W/g, "_") : `p_${name}${web.base ?? "/ui"}_${new URL(o).port}`.replace(/\W/g, "_");
  a.redeem = (u, headers = { "sec-fetch-site": "same-origin" }) => site.fetch(new Request(u, { method: "POST", headers }));
  a.cookie = async (u) => new RegExp(`${a.ck}=([\\w-]+)`).exec((await a.redeem(u)).headers.get("set-cookie") ?? "")?.[1];
  a.page = (c) => site.fetch(new Request(`${o}/ui/`, { headers: { cookie: `${a.ck}=${c}` } }));
  a.tool = (c, n, body = {}) => site.fetch(new Request(`${o}/ui/tool/${n}`, { method: "POST", headers: { cookie: `${a.ck}=${c}`, "P-Req": "1" }, body: JSON.stringify(body) }));
  return a;
};
const A = app(), status = async (r) => (await r).status;

describe("the secret", () => {
  test("origin without a secret throws at defineUi", async () => {
    expect(await err(() => defineUi({ name: "x", web: { origin: O }, view: () => html`x` }))).toMatch(/web\.secret/);
  });
  test("a secret under 32 characters throws", async () => {
    expect(await err(() => defineUi({ name: "x", web: { origin: O, secret: "x".repeat(31) }, view: () => html`x` }))).toMatch(/web\.secret/);
  });
  test("a short secret throws without an origin too", async () => {
    expect(await err(() => defineUi({ name: "x", web: { secret: "short" }, view: () => html`x` }))).toMatch(/web\.secret/);
  });
  test("32 characters is enough", async () => {
    expect(await err(() => defineUi({ name: "x", web: { origin: O, secret: "x".repeat(32), mcp: "/mcp" }, view: () => html`x` }))).toBe("");
  });
});

describe("the origin: bare, https (http only on this machine), and with web.mcp", () => {
  for (const o of ["https://s.test/", "https://s.test/sub", "https://s.test?x=1", "https://s.test#x", "http://localhost:3000/", "https://S.test", "s.test", "http://s.test"])
    test(`origin ${o} is refused: an origin only, https or loopback`, async () => {
      expect(await err(() => defineUi({ name: "x", web: { origin: o, secret: SECRET, mcp: "/mcp" }, view: () => html`x` }))).toMatch(/web\.origin must be https.*origin only/);
    });
  test("a loopback http origin with a port is accepted", async () => {
    expect(await err(() => defineUi({ name: "x", web: { origin: "http://[::1]:8080", secret: SECRET, mcp: "/mcp" }, view: () => html`x` }))).toBe("");
  });
  test("web.origin without web.mcp throws at defineUi: browser calls never run in process, past the server's own auth", async () => {
    expect(await err(() => defineUi({ name: "x", web: { origin: O, secret: SECRET }, view: () => html`x` }))).toMatch(/Set web\.mcp/);
  });
});

describe("a link: one session, once", () => {
  let u, rd;
  test("a link is a sealed token", async () => {
    u = await A.ui.link(as("alice"));
    expect(u).toMatch(/^https:\/\/s\.test\/ui\/l\/[\w-]+$/);
    expect(u.length).toBeLessThan(600);
  });
  test("the token is not readable in the link", () => {
    expect(u).not.toMatch(/bearer|alice/);
  });
  test("the link holds only the bearer token, its id and exp", async () => {
    // open it with the key, as the library derives it: the bearer token and when it ends, nothing about the user
    const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mcp-projector " + SECRET)), "AES-GCM", false, ["decrypt"]);
    const b = Buffer.from(u.split("/l/")[1], "base64url");
    const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12), additionalData: new TextEncoder().encode(JSON.stringify(["link", "s", O, "/ui"])) }, key, b.subarray(12))
      .then((x) => JSON.parse(new TextDecoder().decode(x)), () => ({}));
    expect(Object.keys(p).sort()).toEqual(["exp", "id", "t"]);
    expect(p.t).toBe("bearer-alice");
    expect(p.id).toBeTruthy();
    expect(p.exp).toBeTruthy();
  });
  test("GET shows the Continue page", async () => {
    expect(await status(A.ui.site.fetch(new Request(u)))).toBe(200);
  });
  test("POST redeems it into a session cookie", async () => {
    const c1 = await A.cookie(u);
    expect(c1).toBeTruthy();
    expect(await status(A.page(c1))).toBe(200);
  });
  test("replay: the second POST is refused", async () => {
    expect(await status(A.redeem(u))).toBe(410);
  });
  test("cookie flags", async () => {
    rd = await A.redeem(await A.ui.link(as("alice")));
    expect(rd.headers.get("set-cookie")).toMatch(/^__Host-p_s_ui=[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=(3599|3600); Secure$/);
    expect(rd.headers.get("location")).toBe("/ui/");
  });
  test("HSTS on an https origin", () => {
    expect(rd.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  let r, h;
  test("http on localhost: no __Host- prefix, no Secure, no HSTS, and the port in the name", async () => {
    h = app({ name: "h", web: { origin: "http://localhost:3999" } });
    r = await h.redeem(await h.ui.link(as("a")));
    expect(r.headers.get("set-cookie")).toMatch(/^p_h_ui_3999=[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    expect(r.headers.get("strict-transport-security")).toBeFalsy();
  });
  test("...and that cookie works", async () => {
    expect(await status(h.page(/p_h_ui_3999=([\w-]+)/.exec(r.headers.get("set-cookie"))[1]))).toBe(200);
  });
  test("another local port, another cookie name: one does not overwrite the other", async () => {
    const h2 = app({ name: "h", web: { origin: "http://localhost:4000" } });
    expect((await h2.redeem(await h2.ui.link(as("a")))).headers.get("set-cookie")).toMatch(/^p_h_ui_4000=/);
  });

  test("two concurrent redeems of one link: exactly one session (default claim)", async () => {
    const l = await A.ui.link(as("alice"));
    const rs = await Promise.all(Array.from({ length: 2 }, () => A.redeem(l)));
    expect(rs.map((x) => x.status).sort()).toEqual([303, 410]);
  });
  test("20 concurrent redeems of one link: exactly one session", async () => {
    const l = await A.ui.link(as("alice"));
    const codes = (await Promise.all(Array.from({ length: 20 }, () => A.redeem(l)))).map((x) => x.status);
    expect(codes.filter((s) => s === 303)).toHaveLength(1);
    expect(codes.filter((s) => s !== 303 && s !== 410)).toEqual([]);
  });
  test("different links each redeem once", async () => {
    const many = await Promise.all(Array.from({ length: 20 }, async () => A.redeem(await A.ui.link(as("alice"))).then((x) => x.status)));
    expect(many.filter((s) => s !== 303)).toEqual([]);
  });
});

describe("claim: only on a POST that passed every other check, and only `true` counts", () => {
  const calls = []; let answer: any = true, l;
  const C = app({ name: "c", web: { claim: async (id, exp) => { calls.push([id, exp]); if (answer === "throw") throw new Error("db down"); return answer; } } });

  test("GET never claims", async () => {
    l = await C.ui.link(as("a"));
    await C.ui.site.fetch(new Request(l)); await C.ui.site.fetch(new Request(l));
    expect(calls).toHaveLength(0);
  });
  test("a cross-site POST is refused before it claims", async () => {
    expect(await status(C.redeem(l, { "sec-fetch-site": "cross-site" }))).toBe(403);
    expect(await status(C.redeem(l, { origin: "https://evil.example" }))).toBe(403);
    expect(calls).toHaveLength(0);
  });
  test("another method does not claim", async () => {
    expect(await status(C.ui.site.fetch(new Request(l, { method: "PUT" })))).toBe(405);
    expect(calls).toHaveLength(0);
  });
  test("a tampered link is refused before it claims", async () => {
    expect(await status(C.redeem(l.slice(0, 60) + (l[60] === "A" ? "B" : "A") + l.slice(61)))).toBe(410);
    expect(calls).toHaveLength(0);
  });
  test("an expired link is refused before it claims", () => later(121_000, async () => {
    expect(await status(C.redeem(l))).toBe(410);
    expect(calls).toHaveLength(0);
  }));
  test("claim(id, exp) is called once, with the link's id and expiry", async () => {
    expect(await status(C.redeem(l))).toBe(303);
    expect(calls).toHaveLength(1);
    expect(typeof calls[0][0]).toBe("string");
    expect(Math.abs(calls[0][1] - (Date.now() + 120_000))).toBeLessThan(5000);
  });
  for (const [a, want] of [["throw", 500], [false, 410], ["yes", 410], [1, 410], [undefined, 410]])
    test(`claim ${a === "throw" ? "throwing" : "returning " + JSON.stringify(a)} → ${want}, no session`, async () => {
      answer = a; const r = await C.redeem(await C.ui.link(as("a")));
      expect(r.status).toBe(want);
      expect(r.headers.get("set-cookie")).toBeFalsy();
    });
});

describe("tampering: token, IV, kind, app, secret", () => {
  let u, t, c;
  const flip = (s, i) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
  const other = app({ name: "other" }), wrongBase = app({ web: { base: "/x" } }), wrongOrigin = app({ web: { origin: "https://t.test" } });
  const key2 = app({ web: { secret: "another-secret-".repeat(3) } });
  const page = (cookie) => A.ui.site.fetch(new Request(`${O}/ui/`, { headers: { cookie } })).then((r) => r.status), k = A.ck;
  beforeAll(async () => { u = await A.ui.link(as("alice")); t = u.split("/l/")[1]; });

  test("a changed IV is refused", async () => {
    expect(await status(A.redeem(`${O}/ui/l/${flip(t, 2)}`))).toBe(410);
  });
  test("a changed or cut ciphertext is refused", async () => {
    expect(await status(A.redeem(`${O}/ui/l/${flip(t, 40)}`))).toBe(410);
    expect(await status(A.redeem(`${O}/ui/l/${t.slice(0, -4)}`))).toBe(410);
  });
  test("a link used as a session cookie is refused (kind)", async () => {
    expect(await status(A.page(t))).toBe(401);
  });
  test("a session cookie used as a link is refused (kind)", async () => {
    c = await A.cookie(u);
    expect(await status(A.redeem(`${O}/ui/l/${c}`))).toBe(410);
  });
  test("a changed session cookie is refused", async () => {
    expect(await status(A.page(flip(c, 30)))).toBe(401);
  });
  test("another app with the same secret refuses its links and cookies", async () => {
    expect(await status(other.redeem(await A.ui.link(as("alice"))))).toBe(410);
    expect(await status(other.page(c))).toBe(401);
  });
  test("...and so does the same app at another base", async () => {
    expect(await status(wrongBase.ui.site.fetch(new Request(`${O}/x/l/${(await A.ui.link(as("alice"))).split("/l/")[1]}`, { method: "POST" })))).toBe(410);
  });
  test("...or at another origin", async () => {
    expect(await status(wrongOrigin.redeem(await A.ui.link(as("alice"))))).toBe(410);
  });
  test("another secret refuses them", async () => {
    expect(await status(key2.redeem(await A.ui.link(as("alice"))))).toBe(410);
    expect(await status(key2.page(c))).toBe(401);
  });
  test("a planted or stale cookie of the same name does not hide the real one", async () => {
    expect(await page(`${k}=junk; ${k}=${c}`)).toBe(200);
    expect(await page(`x=1; ${k}=${t}; ${k}=${c}`)).toBe(200);
  });
  test("only the first four are tried", async () => {
    expect(await page(`${`${k}=junk; `.repeat(4)}${k}=${c}`)).toBe(401);
  });
});

describe("expiry", () => {
  let c, ac;
  test("a session works until sessionTtl", async () => {
    c = await A.cookie(await A.ui.link(as("alice")));
    await later(3599_000, async () => expect(await status(A.page(c))).toBe(200));
  });
  test("an expired session is refused", () => later(3601_000, async () => {
    expect(await status(A.page(c))).toBe(401);
  }));
  test("linkTtl is honoured", async () => {
    const T = app({ name: "t", web: { linkTtl: 5, sessionTtl: 10 } }), l = await T.ui.link(as("a"));
    await later(6000, async () => expect(await status(T.redeem(l))).toBe(410));
  });
  test("a session is bounded by its MCP auth's expiry", async () => {
    const exp = Math.floor(Date.now() / 1000) + 30;
    const ar = await A.redeem(await A.ui.link(as("alice", { expiresAt: exp })));
    const age = +/Max-Age=(\d+)/.exec(ar.headers.get("set-cookie"))[1];
    ac = /=([\w-]+)/.exec(ar.headers.get("set-cookie"))[1];
    expect(age).toBeLessThanOrEqual(30);
    expect(age).toBeGreaterThanOrEqual(28);
  });
  test("...and refused once that auth has expired", () => later(31_000, async () => {
    expect(await status(A.page(ac))).toBe(401);
  }));
  test("a link is dead once its MCP auth has expired", async () => {
    const soon = await A.ui.link(as("alice", { expiresAt: Math.floor(Date.now() / 1000) + 2 }));
    await later(3000, async () => expect(await status(A.redeem(soon))).toBe(410));
  });
});

describe("size", () => {
  test("a bearer token too big for a cookie is refused when the link is minted", async () => {
    expect(await err(() => A.ui.link(as("alice", { token: "x".repeat(3000) })))).toMatch(/too long/);
  });
  test("a large one that fits is not", async () => {
    expect(await err(() => A.ui.link(as("alice", { token: "x".repeat(2000) })))).toBe("");
  });
  test("authInfo.extra is not sealed, so its size does not matter", async () => {
    expect(await err(() => A.ui.link(as("alice", { extra: { sub: "alice", blob: "x".repeat(5000) } })))).toBe("");
  });
  test("authInfo without a token: refused, nothing to hand the browser", async () => {
    expect(await err(() => A.ui.link(as("alice", { token: undefined })))).toMatch(/no bearer token/);
  });
});

describe("browser sessions run tools as the token's user, through the server's endpoint", () => {
  let ca, cb;
  beforeAll(async () => { ca = await A.cookie(await A.ui.link(as("alice"))); cb = await A.cookie(await A.ui.link(as("bob"))); });

  test("a browser tool call carries the endpoint's authInfo, with the real token", async () => {
    seen.length = 0;
    expect((await (await A.tool(ca, "add")).json()).content[0].text).toBe("added");
    expect(seen[0]?.extra.sub).toBe("alice");
    expect(seen[0].token).toBe("bearer-alice");
  });
  test("two users never see each other's data", async () => {
    const pa = await (await A.page(ca)).text(), pb = await (await A.page(cb)).text();
    expect(pa).toContain("alice: s");
    expect(pb).toContain("bob: none");
    expect(pb).not.toContain("alice");
  });
  test("a browser session cannot mint a link", async () => {
    const again = await A.tool(ca, "open_s_in_browser");
    expect(again.status).toBe(400);
    expect(await again.text()).toMatch(/Not available/);
  });
  test("nor call p_sync as a tool", async () => {
    expect((await A.tool(ca, "p_sync")).status).toBe(404);
  });

  // A second instance (another isolate, another region): same secret, its own server factory, a shared claim.
  const used = new Set(), claim = (id) => !used.has(id) && !!used.add(id);
  const one = app({ name: "multi", web: { claim } }), two = app({ name: "multi", web: { claim } });
  let c2;
  test("a link minted by one instance redeems on another, once across both (shared claim)", async () => {
    const l = await one.ui.link(as("carol"));
    c2 = await two.cookie(l);
    expect(c2).toBeTruthy();
    expect(await status(one.redeem(l))).toBe(410);
  });
  test("the second instance runs the tool as that user, through its own web.mcp", async () => {
    seen.length = 0;
    expect((await two.tool(c2, "add")).status).toBe(200);
    expect(seen[0]?.extra.sub).toBe("carol");
    expect((db.carol ?? []).join()).toBe("multi");
  });
  test("and its cookie works on the first instance too", async () => {
    expect(await (await one.page(c2)).text()).toContain("carol: multi");
  });

  // A link from a request without auth, and no web.mcp, on the self-started local listener: the server attached in this
  // process; without one, nothing runs.
  let lone, lpage;
  afterAll(() => lone?.site.close());
  test("local listener, no web.mcp, no attached server: browser requests fail (500)", async () => {
    lone = defineUi({ name: "lone", view: () => html`x` }); await lone.site.listen();
    const ll = await lone.link({}), lo = new URL(ll).origin;
    const lc = (await lone.site.fetch(new Request(ll, { method: "POST" }))).headers.get("set-cookie").split(";")[0];
    lpage = () => lone.site.fetch(new Request(`${lo}/ui/`, { headers: { cookie: lc } })).then((r) => r.status);
    expect(await lpage()).toBe(500);
  });
  test("once a server is attached, it is used", async () => {
    lone.attach(new McpServer({ name: "lone", version: "1" }));
    expect(await lpage()).toBe(200);
  });
  test("a second server attached and no web.mcp: browser requests are refused, not run on the latest (someone else's) server", async () => {
    lone.attach(new McpServer({ name: "lone2", version: "1" }));
    expect(await lpage()).toBe(500);
  });

  // A server without auth on a serverless host: a link from a request without auth, and web.mcp, which gets no Authorization.
  test("no auth with web.mcp: the call goes to web.mcp, with no Authorization header", async () => {
    const heard: (string | null)[] = [], N: any = {};
    N.ui = defineUi({ name: "n", web: { origin: O, secret: SECRET, mcp: async (req) => {
      heard.push(req.headers.get("authorization"));
      return createMcpHandler(() => N.ui.attach(new McpServer({ name: "n", version: "1" }))).fetch(req);
    } }, view: ({ user }) => html`<p>${user}</p>` });
    const nc = (await N.ui.site.fetch(new Request(await N.ui.link({}), { method: "POST" }))).headers.get("set-cookie").split(";")[0];
    const np = await N.ui.site.fetch(new Request(`${O}/ui/`, { headers: { cookie: nc } }));
    expect(np.status).toBe(200);
    expect(await np.text()).toContain("<p>local</p>");
    expect(heard).toEqual([null]);
  });
});

describe("from the security review", () => {
  // The view of a browser session can't call a tool that changes data.
  test("a browser session's view cannot call a tool that changes data", async () => {
    let pokes = 0; const V: any = {};
    V.ui = defineUi({ name: "v", view: async ({ call }) => html`<p>${(await call("poke")).content.length}</p>` }); await V.ui.site.listen();
    try {
      V.make = () => { const s = V.ui.attach(new McpServer({ name: "v", version: "1" })); s.registerTool("poke", { description: "write" }, async () => { pokes++; return { content: [] }; }); return s; };
      V.make();
      const vl = await V.ui.link({}), vc = (await V.ui.site.fetch(new Request(vl, { method: "POST" }))).headers.get("set-cookie").split(";")[0];
      expect(await status(V.ui.site.fetch(new Request(new URL("/ui/", vl), { headers: { cookie: vc } })))).toBe(500);
      expect(pokes).toBe(0);
    } finally { V.ui.site.close(); }
  });

  // Two valid session cookies: one was planted, and we can't tell which, so neither counts.
  let ca;
  const both = (cookie) => A.ui.site.fetch(new Request(`${O}/ui/`, { headers: { cookie } })), k = A.ck;
  test("two valid session cookies: signed out, not signed in as the first", async () => {
    ca = await A.cookie(await A.ui.link(as("alice")));
    const cm = await A.cookie(await A.ui.link(as("mallory")));
    expect(await status(both(`${k}=${cm}; ${k}=${ca}`))).toBe(401);
  });
  test("a stale or broken cookie beside a valid one still works", async () => {
    expect(await status(both(`${k}=${ca.slice(0, 40)}x; ${k}=${ca}`))).toBe(200);
  });

  // Requests from a session: P-Req is required, and bodies are capped on every host.
  test("a tool call without the P-Req header is refused (403)", async () => {
    expect(await status(A.ui.site.fetch(new Request(`${O}/ui/tool/add`, { method: "POST", headers: { cookie: `${A.ck}=${ca}` }, body: "{}" })))).toBe(403);
  });
  test("a body over 1 MB is refused on the fetch path (413)", async () => {
    expect(await status(A.tool(ca, "add", { pad: "x".repeat(1_100_000) }))).toBe(413);
  });
  test("a declared length over 1 MB is refused before reading", async () => {
    expect(await status(A.ui.site.fetch(new Request(`${O}/ui/sync`, { method: "POST", headers: { cookie: `${A.ck}=${ca}`, "P-Req": "1", "content-length": "5000000" }, body: "{}" })))).toBe(413);
  });

  // The open tool hands out a sign-in link, so it is not marked read-only: hosts should ask before running it.
  test("open_<name>_in_browser is not annotated readOnlyHint", async () => {
    const [x, y] = InMemoryTransport.createLinkedPair(); await A.make().connect(y);
    const cl = new Client({ name: "c", version: "1" }); await cl.connect(x);
    try {
      const open = (await cl.listTools()).tools.find((t) => t.name === "open_s_in_browser");
      expect(open).toBeTruthy();
      expect(open.annotations?.readOnlyHint).toBeFalsy();
    } finally { await cl.close(); }
  });
});

describe("each browser request is one call to web.mcp: ended with the browser's request or after 30 s, never redirected", () => {
  const at = (name, mcp) => defineUi({ name, web: { origin: O, secret: SECRET, mcp }, view: ({ user }) => html`<p>${user}</p>` });
  const session = async (u, a = {}) => (await u.site.fetch(new Request(await u.link(a), { method: "POST" }))).headers.get("set-cookie").split(";")[0];
  const sync = (u, cookie, signal?: AbortSignal) => u.site.fetch(new Request(`${O}/ui/sync`, { method: "POST", headers: { cookie, "P-Req": "1" }, body: "{}", signal }));

  // A handler that never answers.
  let got, hc; const H = at("hang", (req) => { got = req; return new Promise(() => {}); });
  test("the browser going away ends its call to web.mcp: 500 at once, the request's signal aborted", async () => {
    hc = await session(H);
    const ac = new AbortController(), t0 = now();
    setTimeout(() => ac.abort(), 50);
    const hr = await sync(H, hc, ac.signal);
    expect(hr.status).toBe(500);
    expect(now() - t0).toBeLessThan(2000);
    expect(got.signal.aborted).toBe(true);
  });
  for (const label of ["", " (without AbortSignal.any)"])
    test(`a web.mcp that hangs is given up on after 30 s with a 500 (here shortened to 50 ms)${label}`, async () => {
      const real = AbortSignal.timeout, any = AbortSignal.any;
      let asked, tr, t1;
      AbortSignal.timeout = (ms) => { asked = ms; return real.call(AbortSignal, 50); };
      if (label) AbortSignal.any = undefined;
      const alive = setTimeout(() => {}, 5000); // AbortSignal.timeout's timer does not keep a process alive; a server's listener would
      try {
        t1 = now(); tr = await H.site.fetch(new Request(`${O}/ui/`, { headers: { cookie: hc } }));
      } finally { clearTimeout(alive); AbortSignal.timeout = real; AbortSignal.any = any; }
      expect(tr.status).toBe(500);
      expect(asked).toBe(30_000);
      expect(got.signal.aborted).toBe(true);
      expect(now() - t1).toBeLessThan(2000);
    });

  // Anything but 2xx, 401 or 403 is an error: a server that wants a session (400) is not supported.
  for (const code of [400, 302, 404, 500])
    test(`web.mcp answering ${code}: the browser gets 500`, async () => {
      // The body is a well-formed answer: the status alone must refuse it.
      const E = at("e" + code, async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: { h: "x", html: "<p>x</p>" } } }),
        { status: code, headers: { location: "https://elsewhere.test/", "content-type": "application/json" } }));
      expect((await sync(E, await session(E))).status).toBe(500);
    });

  // A real endpoint that redirects: the request is not followed, so the token never reaches the target.
  test("a web.mcp that redirects fails (500), and the redirect target never sees the bearer token", async () => {
    const heardAt: (string | undefined)[] = [];
    const target = http.createServer((q, r) => { heardAt.push(q.headers.authorization); r.end(); }).listen(0, "127.0.0.1");
    await new Promise((r) => target.on("listening", r));
    const hop = http.createServer((q, r) => { r.writeHead(307, { location: `http://127.0.0.1:${(target.address() as { port: number }).port}/mcp` }); r.end(); }).listen(0, "127.0.0.1");
    await new Promise((r) => hop.on("listening", r));
    try {
      const R = at("redir", `http://127.0.0.1:${(hop.address() as { port: number }).port}/mcp`);
      expect((await sync(R, await session(R, as("alice")))).status).toBe(500);
      expect(heardAt).toEqual([]);
    } finally { target.close(); hop.close(); }
  });

  // An SSE answer with data lines that are not JSON (a priming event, a comment-like line): skipped, not fatal.
  test("an SSE answer with a data line that is not JSON still parses", async () => {
    const json = endpoint(() => A.make());
    const S = at("sse", async (req) => {
      const body = await (await json(req)).text();
      return new Response(`id: 0\ndata:\n\nevent: message\ndata: not json\n\nevent: message\ndata: ${body}\n\n`, { headers: { "content-type": "text/event-stream" } });
    });
    const sr = await sync(S, await session(S, as("sid")));
    expect(sr.status).toBe(200);
    expect((await sr.json()).html).toContain("sid");
  });
});
