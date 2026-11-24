# Web mode

Web mode serves the same view on a normal URL, for people who want a page open beside their work rather than a frame in a conversation. There is no sign-in: a browser session is delegated from an MCP request through a single-use link, and acts as that MCP user.

![The single-use link's Continue page](screenshots/shot-gate.png)

## Set it up

```ts
export const ui = defineUi({
  name: "notes", view,
  web: { origin: "https://app.example.com", tool: "open_notes_in_browser" },
});
```

Serve it with the Node adapter or a fetch handler:

```ts
import http from "node:http";
http.createServer((req, res) => ui.site!.node(req, res)).listen(3000);

// Express: mount at the app root, before body parsers
app.use((req, res, next) => ui.site!.node(req, res, next));

// Fetch-style runtimes
const r = await ui.site!.fetch(request);   // null when the path is outside the mount
```

Options: `origin` (required), `base` (default `/ui`), `linkTtl` (120 s), `sessionTtl` (3600 s, never longer than the MCP auth), `tool` and `toolDescription`. Full tables are in the [reference](reference.md#web-mode). Deployment recipes are in [recipes](../skills/mcp-projection/references/recipes.md).

## How a person gets in

- **With `web.tool` set,** the model gets one extra tool. It uses URL elicitation to ask the host to open the link, so the link goes to the host, not into the model's context. If the host can't, it returns the link as text.
- **From any of your own tool handlers:** `ui.openInBrowser(extra, { server })`, or `ui.link(extra, server)` for the URL alone. `server` is the attached `McpServer` handling the request: the browser session's tool calls run on it.

`web.tool` is the one model-visible tool projection can add. The tool snapshot comparison lists it and passes.

## The single-use link

- The link works once, for `linkTtl` seconds. A GET shows a Continue page, so link unfurlers can't burn it. A POST from that page redeems it (a POST from another site gets 403) and sets an HttpOnly, SameSite=Lax cookie scoped to `base`, Secure on https.
- The link signs the browser in as the MCP user without a further check. The MCP elicitation spec says a server must not send a pre-authenticated URL. This is a deliberate deviation, so that users never sign in on the web. What bounds it: the link works once, for 120 seconds by default, and only from its own Continue page.
- Where the client has no URL elicitation, the link is returned as text, so it passes through the model's context.

## How a browser session works

- It acts as the MCP user that minted the link. Its tool calls carry the same `authInfo` and run on the same server.
- It lasts `sessionTtl`, never longer than the MCP auth it came from (an hour when the request carried no auth). It is not ended when the MCP connection that made it closes, because a per-request server closes after every request. Call `ui.site.revoke(user)` when the user signs out or their MCP session ends.
- Tool handlers called from the web get `extra.authInfo` but can't send notifications or requests (elicitation, sampling) to a client. `ui.link` and `ui.openInBrowser` throw `Not available from the web UI.`
- One session holds up to 8 open views. A ninth replaces the oldest.
- `ui.site.close()` stops the expiry sweep.

## What the server does

- Browser requests need the `P-Req: 1` header.
- Strict CSP, `no-referrer` and `no-store` on every response. Tokens are stored hashed.
- External images, fonts and stylesheets are blocked by the CSP. Use inline SVG, `data:` URIs and `Icon`.
- `site.node` compresses with brotli or gzip, passes requests outside the mount path to `next` with the body unread, answers 413 over 1 MB and 500 on error. With `site.fetch`, compression is left to the platform or CDN.

## Deploying

Links and sessions are kept in memory. Run one instance, or use sticky routing, and expect a restart to end every browser session. See [How it works](how-it-works.md#limits).
