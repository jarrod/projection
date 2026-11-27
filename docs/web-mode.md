# Web mode

Web mode serves the same UI on a normal URL. It's on by default, because in apps that can't draw UIs (Claude Code, for one) it's the only way a person sees it. There is no sign-in and no account: a person only sees the UI because the agent opened it, and the browser carries the agent's own MCP auth. Projector adds no auth of its own; the MCP server checks every request.

![The link's Continue page](https://raw.githubusercontent.com/jarrod/projector/main/docs/screenshots/shot-gate.png)

## What the agent sees

Every UI adds one tool the model can see, `open_<name>_in_browser`, whose description says to use it when the person wants to see or change things themselves. When called, it asks the client to open the link, so the link doesn't pass through the model. Clients that can't do that, or whose prompt fails or times out, get the link back as text, with instructions to share it. To send a link from one of your own tools instead, call `ui.openInBrowser(ctx, { server })` with the tool handler's context.

## Local servers: nothing to set up

With no `origin`, projector serves the UI itself on `127.0.0.1` at a free port, so links work for a person on the same machine. That covers stdio servers run by a local agent. A request that arrives over the network from another host is refused with "Set web.origin" rather than given a link that can't work.

## Hosted servers: give the origin and a secret

A server people reach over the network needs its public address (https), a secret of 32 or more random characters, its MCP endpoint, and requests routed to the UI:

```ts
export const ui = defineUi({ name: "notes", view, web: {
  origin: "https://app.example.com",
  secret: process.env.UI_SECRET,
  mcp: "http://127.0.0.1:3000/mcp",   // the server's own MCP endpoint, reached from this process
} });

http.createServer((req, res) => ui.site!.node(req, res)).listen(3000);
// Express: app.use((req, res, next) => ui.site!.node(req, res, next)), at the root, before body parsers
// Fetch runtimes: await ui.site!.fetch(request), which returns null outside its path
```

## Turning it off

- `web: { tool: false }` keeps web mode but adds no tool: links come only from your own `ui.openInBrowser` calls.
- `web: false` turns web mode off. The UI is then reachable only through apps that support MCP Apps, which projector hasn't been tested in.

## The link

- It carries the agent's bearer token, encrypted, so the browser can act with exactly the agent's access. It works once, for two minutes by default.
- Opening it shows a Continue page, so link previews in chat apps can't use it up. Pressing Continue puts the encrypted token in a cookie.
- The MCP spec says servers shouldn't send pre-authenticated links. Projector does on purpose: the person has no identity of their own, only the agent's. The link is single-use, short-lived, redeemable only from its own page, and the open tool isn't marked read-only, so hosts ask before running it.

## In the browser

- Every page check and click is sent to the server's own MCP endpoint (`web.mcp`) as a normal `tools/call` with the agent's token. The server's auth checks the token exactly as it checks the agent's: validity, revocation, scopes, tenancy, and anything else keyed on the token.
- These requests come from projector, on the server, not from the person's browser. So `web.mcp` must authorise by the token alone: don't trust a caller because of its network address (loopback, an internal IP, an allowlist), and expect network-level rate limits and firewall rules to see one caller. A server whose only auth is something the browser can't carry, such as an API key in a header, refuses browser requests: the UI fails closed there. Issue bearer tokens (OAuth) to get a working UI.
- When the server refuses the token (expired, revoked), the page says to ask the assistant again. There is no session to end: access ends when the agent's does. `web.sessionTtl` (default an hour) caps how long the cookie is kept.
- The cookie is `__Host-` prefixed, `Secure`, `HttpOnly`, `SameSite=Strict`, and the site sends HSTS. On plain `http://localhost` it drops the prefix and `Secure`. `web.origin` must be https otherwise.
- A browser can't get a new link: the open tool and `ui.link` refuse requests that come from the UI.
- Only the local UI on 127.0.0.1 (no `web.origin`) runs browser calls in the same process, for servers without auth such as a local stdio server. Any UI with an `origin` sends every call through `web.mcp`, so a server's own auth always applies, whatever form it takes.

## Deploying

Projector keeps nothing in server memory, except which links have been used. A hosted server sets:

```ts
web: {
  origin: "https://app.example.com",
  secret: env.UI_SECRET,                       // 32+ random characters, the same on every instance
  mcp: (req) => handleMcp(req),                // or the endpoint's URL
  claim: (id, exp) => markUsed(id, exp),       // true the first time only: an insert with a unique key
}
```

- **`secret`** encrypts links and cookies. Required with `origin`. Changing it ends every link and cookie.
- **`mcp`** is where browser requests go: the server's MCP endpoint, as a URL or as a function that handles a `Request` in this process (use the function on Workers). Required whenever `origin` is set. It must be a stateless endpoint (no MCP sessions): one request per check. If your main endpoint keeps sessions, mount a stateless one beside it for projector.
- **`claim`** makes links single-use. The default remembers used links in this process, which is enough for one long-running instance. With several instances or on a serverless host, back it with your own storage, or a link could be used again on another instance until it expires.

- **`origin`** is a bare https origin (`https://app.example.com`, no path or trailing slash). Serve the UI from its own origin or subdomain where you can: the cookie covers the whole origin, so a script injected into any other page there could act with the agent's token.
- Links and cookies hold the agent's token, encrypted with `secret`. Keep the secret as safe as the tokens themselves: anyone with both a logged link and the secret could read the token.

For Cloudflare Workers, see [`examples/cloudflare-worker`](https://github.com/jarrod/projector/tree/main/examples/cloudflare-worker).

### Workers: pass `authInfo` to the handler

Projector gets the agent's token and the viewer from `authInfo` in the tool handler. On Workers with the `agents` package's `createMcpHandler` behind `workers-oauth-provider`, the handler fills `authInfo` from the OAuth context only when that context has a `clientId`. Delegated and service tokens often have none, so `authInfo` is undefined: the open tool has no token to put in the link, and `identify` finds no viewer. Pass it yourself:

```ts
createMcpHandler(build).fetch(request, {
  authInfo: { token, clientId, scopes: [], expiresAt, extra: { sub: userId } },
});
```

`token` is the agent's bearer token. `expiresAt` (seconds) ends the browser's cookie with the token. The default `identify` reads `extra.sub`; if you set `identify`, return the viewer from whatever you put in `extra`.

Projector sets `Host` on the request it passes to a function `web.mcp` (the origin's host), so handlers that check it for DNS rebinding accept it.
