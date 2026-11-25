# Changelog

## Unreleased
- Web mode is on by default. Every UI adds `open_<name>_in_browser`: rename it with `web.tool`, drop it with `tool: false`, or turn web mode off with `web: false`. Without `origin`, the UI is served on 127.0.0.1 at a free port. A request from a non-loopback host then fails with "Set web.origin" instead of getting a link that can't work.
- `p_sync` is listed only to clients that announce MCP Apps (`io.modelcontextprotocol/ui`), so a plain client's model never sees it. Calls still work.
- If URL elicitation fails or times out, `open_<name>_in_browser` returns the link as text instead of an error.

## 0.3
- `ui.link(extra, server)` and `ui.openInBrowser(extra, { server })` need the attached server.
- An authenticated request must carry `authInfo.extra.sub` (or pass `identify`). The client id is no longer used as the user.
- A view must return `` html`...` ``.
- `Menu` no longer sets `role="menu"`. It is a plain list of buttons and links, reached with Tab.
