// Web sign-in with nothing kept on the server: links and session cookies are sealed, and hold the agent's bearer token;
// single use is web.claim. Every browser request goes to the server's own MCP endpoint (here in process) with that token.
const NS = new URL("../examples/notes-server", import.meta.url).pathname;
const { defineUi, html } = await import(`${NS}/node_modules/mcp-projector/dist/index.js`);
const { McpServer } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`);
const { WebStandardStreamableHTTPServerTransport } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js`);
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const err = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };

const O = "https://s.test", SECRET = "test-secret-".repeat(4), now = Date.now;
let skew = 0; Date.now = () => now() + skew; // a clock the tests can move
const db = {}, seen = [];
const as = (sub, more = {}) => ({ authInfo: { token: "bearer-" + sub, clientId: "app", scopes: [], extra: { sub }, ...more } });

/** The server's MCP endpoint: stateless, with its own bearer check ("bearer-<sub>" is that user's token). */
const endpoint = (make) => async (req) => {
  const m = /^Bearer (bearer-(\w+))$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return new Response(null, { status: 401 });
  const t = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await make().connect(t);
  return t.handleRequest(req, { authInfo: { token: m[1], clientId: "app", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600, extra: { sub: m[2] } } });
};
/** One app: a ui and a server factory, as a serverless integrator would write them. */
const app = ({ name = "s", web = {} } = {}) => {
  const a = {};
  a.ui = defineUi({ name, web: { origin: O, secret: SECRET, mcp: endpoint(() => a.make()), ...web },
    view: async ({ user, call }) => html`<p>${user}: ${(await call("mine")).content[0].text}</p>` });
  a.make = () => {
    const s = a.ui.attach(new McpServer({ name, version: "1" }));
    const sub = (x) => x.authInfo?.extra?.sub ?? "local";
    s.registerTool("mine", { description: "read", annotations: { readOnlyHint: true } }, async (x) => ({ content: [{ type: "text", text: (db[sub(x)] ?? []).join() || "none" }] }));
    s.registerTool("add", { description: "write" }, async (x) => { seen.push(x.authInfo); (db[sub(x)] ??= []).push(name); return { content: [{ type: "text", text: "added" }] }; });
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

// --- the secret ---
ok(/web\.secret/.test(await err(() => defineUi({ name: "x", web: { origin: O }, view: () => html`x` }))), "origin without a secret throws at defineUi");
ok(/web\.secret/.test(await err(() => defineUi({ name: "x", web: { origin: O, secret: "x".repeat(31) }, view: () => html`x` }))), "a secret under 32 characters throws");
ok(/web\.secret/.test(await err(() => defineUi({ name: "x", web: { secret: "short" }, view: () => html`x` }))), "a short secret throws without an origin too");
ok(await err(() => defineUi({ name: "x", web: { origin: O, secret: "x".repeat(32), mcp: "/mcp" }, view: () => html`x` })) === "", "32 characters is enough");

// --- the origin: bare, https (http only on this machine), and with web.mcp ---
for (const o of ["https://s.test/", "https://s.test/sub", "https://s.test?x=1", "https://s.test#x", "http://localhost:3000/", "https://S.test", "s.test", "http://s.test"])
  ok(/web\.origin must be https.*origin only/.test(await err(() => defineUi({ name: "x", web: { origin: o, secret: SECRET, mcp: "/mcp" }, view: () => html`x` }))), `origin ${o} is refused: an origin only, https or loopback`);
ok(await err(() => defineUi({ name: "x", web: { origin: "http://[::1]:8080", secret: SECRET, mcp: "/mcp" }, view: () => html`x` })) === "", "a loopback http origin with a port is accepted");
ok(/Set web\.mcp/.test(await err(() => defineUi({ name: "x", web: { origin: O, secret: SECRET }, view: () => html`x` }))),
  "web.origin without web.mcp throws at defineUi: browser calls never run in process, past the server's own auth");

// --- a link: one session, once ---
let u = await A.ui.link(as("alice"));
ok(/^https:\/\/s\.test\/ui\/l\/[\w-]+$/.test(u) && u.length < 600, `a link is a sealed token (${u.length} chars)`);
ok(!new RegExp("bearer|alice").test(u), "the token is not readable in the link");
{ // open it with the key, as the library derives it: the bearer token and when it ends, nothing about the user
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mcp-projector " + SECRET)), "AES-GCM", false, ["decrypt"]);
  const b = Buffer.from(u.split("/l/")[1], "base64url");
  const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12), additionalData: new TextEncoder().encode(JSON.stringify(["link", "s", O, "/ui"])) }, key, b.subarray(12))
    .then((x) => JSON.parse(new TextDecoder().decode(x)), () => ({}));
  ok(p.t === "bearer-alice" && p.id && p.exp && Object.keys(p).sort().join() === "exp,id,t", `the link holds only the bearer token, its id and exp (${Object.keys(p)})`);
}
ok(await status(A.ui.site.fetch(new Request(u))) === 200, "GET shows the Continue page");
const c1 = await A.cookie(u);
ok(c1 && await status(A.page(c1)) === 200, "POST redeems it into a session cookie");
ok(await status(A.redeem(u)) === 410, "replay: the second POST is refused");
const rd = await A.redeem(await A.ui.link(as("alice"))), sc = rd.headers.get("set-cookie");
ok(/^__Host-p_s_ui=[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=(3599|3600); Secure$/.test(sc) && rd.headers.get("location") === "/ui/", `cookie flags: ${sc.replace(/=[\w-]{20,}/, "=…")}`);
ok(rd.headers.get("strict-transport-security") === "max-age=31536000", "HSTS on an https origin");
{
  const h = app({ name: "h", web: { origin: "http://localhost:3999" } }), r = await h.redeem(await h.ui.link(as("a")));
  ok(/^p_h_ui_3999=[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/.test(r.headers.get("set-cookie")) && !r.headers.get("strict-transport-security"), "http on localhost: no __Host- prefix, no Secure, no HSTS, and the port in the name");
  ok(await status(h.page(/p_h_ui_3999=([\w-]+)/.exec(r.headers.get("set-cookie"))[1])) === 200, "...and that cookie works");
  const h2 = app({ name: "h", web: { origin: "http://localhost:4000" } });
  ok((await h2.redeem(await h2.ui.link(as("a")))).headers.get("set-cookie").startsWith("p_h_ui_4000="), "another local port, another cookie name: one does not overwrite the other");
}

u = await A.ui.link(as("alice"));
const rs = await Promise.all(Array.from({ length: 2 }, () => A.redeem(u)));
ok(rs.filter((r) => r.status === 303).length === 1 && rs.some((r) => r.status === 410), "two concurrent redeems of one link: exactly one session (default claim)");
u = await A.ui.link(as("alice"));
const rs20 = await Promise.all(Array.from({ length: 20 }, () => A.redeem(u)));
ok(rs20.filter((r) => r.status === 303).length === 1 && rs20.every((r) => r.status === 303 || r.status === 410), "20 concurrent redeems of one link: exactly one session");
const many = await Promise.all(Array.from({ length: 20 }, async () => A.redeem(await A.ui.link(as("alice"))).then((r) => r.status)));
ok(many.every((s) => s === 303), "different links each redeem once");

// --- claim: only on a POST that passed every other check, and only `true` counts ---
{
  const calls = []; let answer = true;
  const C = app({ name: "c", web: { claim: async (id, exp) => { calls.push([id, exp]); if (answer === "throw") throw new Error("db down"); return answer; } } });
  let l = await C.ui.link(as("a"));
  await C.ui.site.fetch(new Request(l)); await C.ui.site.fetch(new Request(l));
  ok(calls.length === 0, "GET never claims");
  ok(await status(C.redeem(l, { "sec-fetch-site": "cross-site" })) === 403 && await status(C.redeem(l, { origin: "https://evil.example" })) === 403 && calls.length === 0, "a cross-site POST is refused before it claims");
  ok(await status(C.ui.site.fetch(new Request(l, { method: "PUT" }))) === 405 && calls.length === 0, "another method does not claim");
  ok(await status(C.redeem(l.slice(0, 60) + (l[60] === "A" ? "B" : "A") + l.slice(61))) === 410 && calls.length === 0, "a tampered link is refused before it claims");
  skew = 121_000; ok(await status(C.redeem(l)) === 410 && calls.length === 0, "an expired link is refused before it claims"); skew = 0;
  ok(await status(C.redeem(l)) === 303 && calls.length === 1 && typeof calls[0][0] === "string" && Math.abs(calls[0][1] - (Date.now() + 120_000)) < 5000, "claim(id, exp) is called once, with the link's id and expiry");
  for (const [a, want] of [["throw", 500], [false, 410], ["yes", 410], [1, 410], [undefined, 410]]) {
    answer = a; const r = await C.redeem(await C.ui.link(as("a")));
    ok(r.status === want && !r.headers.get("set-cookie"), `claim ${a === "throw" ? "throwing" : "returning " + JSON.stringify(a)} → ${want}, no session`);
  }
}

// --- tampering: token, IV, kind, app, secret ---
{
  u = await A.ui.link(as("alice"));
  const t = u.split("/l/")[1], flip = (s, i) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
  ok(await status(A.redeem(`${O}/ui/l/${flip(t, 2)}`)) === 410, "a changed IV is refused");
  ok(await status(A.redeem(`${O}/ui/l/${flip(t, 40)}`)) === 410 && await status(A.redeem(`${O}/ui/l/${t.slice(0, -4)}`)) === 410, "a changed or cut ciphertext is refused");
  ok(await status(A.page(t)) === 401, "a link used as a session cookie is refused (kind)");
  const c = await A.cookie(u);
  ok(await status(A.redeem(`${O}/ui/l/${c}`)) === 410, "a session cookie used as a link is refused (kind)");
  ok(await status(A.page(flip(c, 30))) === 401, "a changed session cookie is refused");
  const other = app({ name: "other" }), wrongBase = app({ web: { base: "/x" } }), wrongOrigin = app({ web: { origin: "https://t.test" } });
  ok(await status(other.redeem(await A.ui.link(as("alice")))) === 410 && await status(other.page(c)) === 401, "another app with the same secret refuses its links and cookies");
  ok(await status(wrongBase.ui.site.fetch(new Request(`${O}/x/l/${(await A.ui.link(as("alice"))).split("/l/")[1]}`, { method: "POST" }))) === 410, "...and so does the same app at another base");
  ok(await status(wrongOrigin.redeem(await A.ui.link(as("alice")))) === 410, "...or at another origin");
  const key2 = app({ web: { secret: "another-secret-".repeat(3) } });
  ok(await status(key2.redeem(await A.ui.link(as("alice")))) === 410 && await status(key2.page(c)) === 401, "another secret refuses them");
  const site = A.ui.site, page = (cookie) => site.fetch(new Request(`${O}/ui/`, { headers: { cookie } })).then((r) => r.status), k = A.ck;
  ok(await page(`${k}=junk; ${k}=${c}`) === 200 && await page(`x=1; ${k}=${t}; ${k}=${c}`) === 200, "a planted or stale cookie of the same name does not hide the real one");
  ok(await page(`${`${k}=junk; `.repeat(4)}${k}=${c}`) === 401, "only the first four are tried");
}

// --- expiry ---
{
  const c = await A.cookie(await A.ui.link(as("alice")));
  skew = 3599_000; ok(await status(A.page(c)) === 200, "a session works until sessionTtl");
  skew = 3601_000; ok(await status(A.page(c)) === 401, "an expired session is refused"); skew = 0;
  const T = app({ name: "t", web: { linkTtl: 5, sessionTtl: 10 } }), l = await T.ui.link(as("a"));
  skew = 6000; ok(await status(T.redeem(l)) === 410, "linkTtl is honoured"); skew = 0;
  const exp = Math.floor(Date.now() / 1000) + 30;
  const ar = await A.redeem(await A.ui.link(as("alice", { expiresAt: exp })));
  const age = +/Max-Age=(\d+)/.exec(ar.headers.get("set-cookie"))[1], ac = /=([\w-]+)/.exec(ar.headers.get("set-cookie"))[1];
  ok(age <= 30 && age >= 28, `a session is bounded by its MCP auth's expiry (Max-Age ${age})`);
  skew = 31_000; ok(await status(A.page(ac)) === 401, "...and refused once that auth has expired"); skew = 0;
  const soon = await A.ui.link(as("alice", { expiresAt: Math.floor(Date.now() / 1000) + 2 }));
  skew = 3000; ok(await status(A.redeem(soon)) === 410, "a link is dead once its MCP auth has expired"); skew = 0;
}

// --- size ---
ok(/too long/.test(await err(() => A.ui.link(as("alice", { token: "x".repeat(3000) })))), "a bearer token too big for a cookie is refused when the link is minted");
ok(!(await err(() => A.ui.link(as("alice", { token: "x".repeat(2000) })))), "a large one that fits is not");
ok(!(await err(() => A.ui.link(as("alice", { extra: { sub: "alice", blob: "x".repeat(5000) } })))), "authInfo.extra is not sealed, so its size does not matter");
ok(/no bearer token/.test(await err(() => A.ui.link(as("alice", { token: undefined })))), "authInfo without a token: refused, nothing to hand the browser");

// --- browser sessions run tools as the token's user, through the server's endpoint ---
{
  const ca = await A.cookie(await A.ui.link(as("alice"))), cb = await A.cookie(await A.ui.link(as("bob")));
  seen.length = 0;
  ok((await (await A.tool(ca, "add")).json()).content[0].text === "added" && seen[0]?.extra.sub === "alice" && seen[0].token === "bearer-alice", "a browser tool call carries the endpoint's authInfo, with the real token");
  const pa = await (await A.page(ca)).text(), pb = await (await A.page(cb)).text();
  ok(pa.includes("alice: s") && pb.includes("bob: none") && !pb.includes("alice"), "two users never see each other's data");
  const again = await A.tool(ca, "open_s_in_browser");
  ok(again.status === 400 && /Not available/.test(await again.text()), "a browser session cannot mint a link");
  ok((await A.tool(ca, "p_sync")).status === 404, "nor call p_sync as a tool");

  // A second instance (another isolate, another region): same secret, its own server factory, a shared claim.
  const used = new Set(), claim = (id) => !used.has(id) && !!used.add(id);
  const one = app({ name: "multi", web: { claim } }), two = app({ name: "multi", web: { claim } });
  const l = await one.ui.link(as("carol")), c2 = await two.cookie(l);
  ok(c2 && await status(one.redeem(l)) === 410, "a link minted by one instance redeems on another, once across both (shared claim)");
  seen.length = 0;
  ok((await two.tool(c2, "add")).status === 200 && seen[0]?.extra.sub === "carol" && (db.carol ?? []).join() === "multi", "the second instance runs the tool as that user, through its own web.mcp");
  ok((await (await one.page(c2)).text()).includes("carol: multi"), "and its cookie works on the first instance too");

  // A link from a request without auth, and no web.mcp, on the self-started local listener: the server attached in this
  // process; without one, nothing runs.
  const lone = defineUi({ name: "lone", view: () => html`x` }); await lone.site.listen();
  const ll = await lone.link({}), lo = new URL(ll).origin;
  const lc = (await lone.site.fetch(new Request(ll, { method: "POST" }))).headers.get("set-cookie").split(";")[0];
  const lpage = () => lone.site.fetch(new Request(`${lo}/ui/`, { headers: { cookie: lc } })).then((r) => r.status);
  ok(await lpage() === 500, "local listener, no web.mcp, no attached server: browser requests fail (500)");
  lone.attach(new McpServer({ name: "lone", version: "1" }));
  ok(await lpage() === 200, "once a server is attached, it is used");
  lone.attach(new McpServer({ name: "lone2", version: "1" }));
  ok(await lpage() === 500, "a second server attached and no web.mcp: browser requests are refused, not run on the latest (someone else's) server");
  lone.site.close();

  // A server without auth on a serverless host: a link from a request without auth, and web.mcp, which gets no Authorization.
  const heard = [], N = {};
  N.ui = defineUi({ name: "n", web: { origin: O, secret: SECRET, mcp: async (req) => {
    heard.push(req.headers.get("authorization"));
    const t = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await N.ui.attach(new McpServer({ name: "n", version: "1" })).connect(t);
    return t.handleRequest(req);
  } }, view: ({ user }) => html`<p>${user}</p>` });
  const nc = (await N.ui.site.fetch(new Request(await N.ui.link({}), { method: "POST" }))).headers.get("set-cookie").split(";")[0];
  const np = await N.ui.site.fetch(new Request(`${O}/ui/`, { headers: { cookie: nc } }));
  ok(np.status === 200 && (await np.text()).includes("<p>local</p>") && heard.length === 1 && heard[0] === null, "no auth with web.mcp: the call goes to web.mcp, with no Authorization header");
}

// --- from the security review ---
{
  // The view of a browser session can't call a tool that changes data.
  let pokes = 0; const V = {};
  V.ui = defineUi({ name: "v", view: async ({ call }) => html`<p>${(await call("poke")).content.length}</p>` }); await V.ui.site.listen();
  V.make = () => { const s = V.ui.attach(new McpServer({ name: "v", version: "1" })); s.registerTool("poke", { description: "write" }, async () => { pokes++; return { content: [] }; }); return s; };
  V.make();
  const vl = await V.ui.link({}), vc = (await V.ui.site.fetch(new Request(vl, { method: "POST" }))).headers.get("set-cookie").split(";")[0];
  ok(await status(V.ui.site.fetch(new Request(new URL("/ui/", vl), { headers: { cookie: vc } }))) === 500 && pokes === 0, "a browser session's view cannot call a tool that changes data");
  V.ui.site.close();

  // Two valid session cookies: one was planted, and we can't tell which, so neither counts.
  const ca = await A.cookie(await A.ui.link(as("alice"))), cm = await A.cookie(await A.ui.link(as("mallory")));
  const both = (cookie) => A.ui.site.fetch(new Request(`${O}/ui/`, { headers: { cookie } })), k = A.ck;
  ok(await status(both(`${k}=${cm}; ${k}=${ca}`)) === 401, "two valid session cookies: signed out, not signed in as the first");
  ok(await status(both(`${k}=${ca.slice(0, 40)}x; ${k}=${ca}`)) === 200, "a stale or broken cookie beside a valid one still works");

  // Requests from a session: P-Req is required, and bodies are capped on every host.
  ok(await status(A.ui.site.fetch(new Request(`${O}/ui/tool/add`, { method: "POST", headers: { cookie: `${A.ck}=${ca}` }, body: "{}" }))) === 403, "a tool call without the P-Req header is refused (403)");
  ok(await status(A.tool(ca, "add", { pad: "x".repeat(1_100_000) })) === 413, "a body over 1 MB is refused on the fetch path (413)");
  ok(await status(A.ui.site.fetch(new Request(`${O}/ui/sync`, { method: "POST", headers: { cookie: `${A.ck}=${ca}`, "P-Req": "1", "content-length": "5000000" }, body: "{}" }))) === 413, "a declared length over 1 MB is refused before reading");

  // The open tool hands out a sign-in link, so it is not marked read-only: hosts should ask before running it.
  const { Client } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
  const { InMemoryTransport } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`);
  const [x, y] = InMemoryTransport.createLinkedPair(); await A.make().connect(y);
  const cl = new Client({ name: "c", version: "1" }); await cl.connect(x);
  const open = (await cl.listTools()).tools.find((t) => t.name === "open_s_in_browser");
  ok(open && !open.annotations?.readOnlyHint, "open_<name>_in_browser is not annotated readOnlyHint");
  await cl.close();
}

// --- each browser request is one call to web.mcp: ended with the browser's request or after 30 s, never redirected ---
{
  const at = (name, mcp) => defineUi({ name, web: { origin: O, secret: SECRET, mcp }, view: ({ user }) => html`<p>${user}</p>` });
  const session = async (u, a = {}) => (await u.site.fetch(new Request(await u.link(a), { method: "POST" }))).headers.get("set-cookie").split(";")[0];
  const sync = (u, cookie, signal) => u.site.fetch(new Request(`${O}/ui/sync`, { method: "POST", headers: { cookie, "P-Req": "1" }, body: "{}", signal }));

  // A handler that never answers.
  let got; const H = at("hang", (req) => { got = req; return new Promise(() => {}); }), hc = await session(H);
  const ac = new AbortController(), t0 = now();
  setTimeout(() => ac.abort(), 50);
  const hr = await sync(H, hc, ac.signal);
  ok(hr.status === 500 && now() - t0 < 2000 && got.signal.aborted, `the browser going away ends its call to web.mcp: 500 at once, the request's signal aborted (${now() - t0} ms)`);
  const real = AbortSignal.timeout, any = AbortSignal.any;
  for (const label of ["", " (without AbortSignal.any)"]) {
    let asked; AbortSignal.timeout = (ms) => { asked = ms; return real.call(AbortSignal, 50); };
    if (label) AbortSignal.any = undefined;
    const alive = setTimeout(() => {}, 5000); // AbortSignal.timeout's timer does not keep a process alive; a server's listener would
    const t1 = now(), tr = await H.site.fetch(new Request(`${O}/ui/`, { headers: { cookie: hc } }));
    clearTimeout(alive);
    AbortSignal.timeout = real; AbortSignal.any = any;
    ok(tr.status === 500 && asked === 30_000 && got.signal.aborted && now() - t1 < 2000, `a web.mcp that hangs is given up on after 30 s with a 500 (here shortened to 50 ms)${label}`);
  }

  // Anything but 2xx, 401 or 403 is an error: a server that wants a session (400) is not supported.
  for (const code of [400, 302, 404, 500]) {
    // The body is a well-formed answer: the status alone must refuse it.
    const E = at("e" + code, async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: { h: "x", html: "<p>x</p>" } } }),
      { status: code, headers: { location: "https://elsewhere.test/", "content-type": "application/json" } }));
    ok((await sync(E, await session(E))).status === 500, `web.mcp answering ${code}: the browser gets 500`);
  }

  // A real endpoint that redirects: the request is not followed, so the token never reaches the target.
  const http = await import("node:http"), heardAt = [];
  const target = http.createServer((q, r) => { heardAt.push(q.headers.authorization); r.end(); }).listen(0, "127.0.0.1");
  await new Promise((r) => target.on("listening", r));
  const hop = http.createServer((q, r) => { r.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/mcp` }); r.end(); }).listen(0, "127.0.0.1");
  await new Promise((r) => hop.on("listening", r));
  const R = at("redir", `http://127.0.0.1:${hop.address().port}/mcp`);
  ok((await sync(R, await session(R, as("alice")))).status === 500 && heardAt.length === 0, "a web.mcp that redirects fails (500), and the redirect target never sees the bearer token");
  target.close(); hop.close();

  // An SSE answer with data lines that are not JSON (a priming event, a comment-like line): skipped, not fatal.
  const json = endpoint(() => A.make());
  const S = at("sse", async (req) => {
    const body = await (await json(req)).text();
    return new Response(`id: 0\ndata:\n\nevent: message\ndata: not json\n\nevent: message\ndata: ${body}\n\n`, { headers: { "content-type": "text/event-stream" } });
  });
  const sr = await sync(S, await session(S, as("sid")));
  ok(sr.status === 200 && (await sr.json()).html.includes("sid"), "an SSE answer with a data line that is not JSON still parses");
}

Date.now = now;
console.log(fails ? `\n${fails} FAILED` : "\nall session checks passed");
process.exit(fails ? 1 : 0);
