# How it works

An MCP server has two audiences: the model, which calls tools, and the people working with it. Projection gives the people a live view of the same server, using the same tools, without changing anything the model sees.

## Three ideas

- **The UI is one server function.** `view({ user, params })` reads your data and returns HTML. Nothing renders in the browser.
- **Buttons call your tools.** A click goes through the server's own `tools/call` handler, so the same validation and the same handler run as when the agent calls the tool.
- **Tool calls update the UI.** After any tool call, by the agent or a person, every open view renders again. If data changes outside a tool, call `ui.write()`.

## What `attach` adds

- A `ui://` resource holding the page shell: CSS and a small runtime.
- `_meta.ui.resourceUri` on the `attachTo` tools, for apps that support the MCP Apps extension. Not yet tested in any such app.
- A tool called `p_sync` that the page polls. Only clients that support MCP Apps see it listed, marked app-only.
- One model-visible tool, `open_<name>_in_browser`, that sends the person a link to the UI ([web mode](web-mode.md)).

## One update

1. The agent calls `add_note`. Your handler runs and returns as usual.
2. Projection bumps a change counter. The agent doesn't wait for the UI.
3. Each open page is waiting on `p_sync`. They wake up, and the view runs once per distinct user and params.
4. If the HTML changed, the page receives it and updates in place, matching elements by `id` and briefly highlighting changed rows.

The server keeps nothing per viewer. What a viewer is looking at (search text, page, open row) lives in their browser as `params`.

## Limits

- One process. With several instances, a change on one reaches viewers on another only when their poll times out, up to 25 seconds.
- The whole view is sent when it changes, so page big lists (about 200 rows at most).
- Not yet tried inside a real host. Still unconfirmed there: that the host hides `p_sync` from the model, and that it tolerates a call held open for 25 seconds.
