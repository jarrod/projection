# Changelog

## Unreleased
- A function `web.mcp` now gets the request with `Host` set to the origin's host, as a real POST would. Handlers that check `Host` against DNS rebinding (the `agents` MCP handler on `localhost` and `*.workers.dev`) no longer refuse every page check.
- Docs: passing `authInfo` to a stateless handler on Workers, with a troubleshooting entry.
- The view reads through the server's tools. It gets `call(tool, args)`, which runs a tool through the server's own `tools/call` handler as the person viewing, and returns its result. Only read tools: annotated `readOnlyHint`, or listed in the new `reads` option for tools that only read but aren't annotated. Other tools are refused before they run, and a view's reads never refresh views. Reading a store directly from the view is no longer the documented way, and the example no longer does it.
- Open pages check for changes every 5 seconds (`poll`, in seconds), straight after their own action, and not while hidden. Each check is answered at once: the server runs the view and sends HTML only if it changed. This replaces held requests and the change counter, so changes from anywhere, on any instance, show up within one check.
- Removed `ui.write()`: nothing needs to signal changes.
- The browser carries the agent's own MCP auth, and projector adds none of its own. A link seals the agent's bearer token; redeeming it puts the sealed token in a cookie (`__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, plus HSTS). Every page check and click is a normal `tools/call` to the server's own MCP endpoint (new `web.mcp`: a URL or an in-process handler) with that token, so the server's auth checks every request, and access ends exactly when the agent's does.
- Works on serverless hosts. Links and cookies are encrypted (`web.secret`, required with `origin`), so the server keeps nothing between requests. `web.claim` keeps links single-use, by default in this process's memory; on several instances or serverless, back it with shared storage. See `examples/cloudflare-worker`.
- `web.origin` must be a bare https origin (plain http only on localhost), and `web.mcp` is required with it. Only the local 127.0.0.1 UI runs browser calls in process. `web.mcp` must be a stateless MCP endpoint.
- `open_<name>_in_browser` is no longer annotated `readOnlyHint`: it hands out a pre-authenticated link, so hosts should ask first. It refuses requests that come from the UI.
- Request bodies over 1 MB are refused on every host.
- Removed `ui.site.revoke(user)`: access ends when the server refuses the agent's token.
- `ui.link(extra)` is async and no longer takes the server. A used link still shows its Continue page; pressing Continue says it has expired.
- Tool handlers no longer need `ui.identify(extra)`: tools called from the UI get the same `authInfo` as when the agent calls them.
- Requires Node 22.18 or later. Node 20 is end of life.
- Requires the MCP TypeScript SDK v2: `@modelcontextprotocol/server` 2.4 or later, with zod 4.2 or later. SDK v1 (`@modelcontextprotocol/sdk`) is no longer supported. Tool handlers read auth from their context, `ctx.http.authInfo`. `mcp-projector/testing` uses `@modelcontextprotocol/client`. On the 2026-07-28 protocol a server can't ask the client to open a URL, so `open_<name>_in_browser` returns the link as text.
- Loads without Node built-ins and does no work at import time.
- `attach` errors say whether the tool was registered too early or the SDK isn't supported.
- Renamed from `mcp-projection` to `mcp-projector`: the package, its imports, the command and the skill. Nothing else in the API changed.
- Web mode is on by default. Every UI adds `open_<name>_in_browser`: rename it with `web.tool`, drop it with `tool: false`, or turn web mode off with `web: false`. Without `origin`, the UI is served on 127.0.0.1 at a free port. A request from a non-loopback host then fails with "Set web.origin" instead of getting a link that can't work.
- `p_sync` is listed only to clients that announce MCP Apps (`io.modelcontextprotocol/ui`), so a plain client's model never sees it. Calls still work.
- If URL elicitation fails or times out, `open_<name>_in_browser` returns the link as text instead of an error.

## 0.3
- `ui.link(extra, server)` and `ui.openInBrowser(extra, { server })` need the attached server.
- An authenticated request must carry `authInfo.extra.sub` (or pass `identify`). The client id is no longer used as the user.
- A view must return `` html`...` ``.
- `Menu` no longer sets `role="menu"`. It is a plain list of buttons and links, reached with Tab.
