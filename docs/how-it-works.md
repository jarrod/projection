# How it works

An MCP server has two audiences: the model, which calls tools, and the people working with it. Projector gives the people a live view of the same server, using the same tools, without changing anything the model sees.

## Three ideas

- **The UI is one server function that reads through your tools.** `view({ call, params })` calls the server's read tools and returns HTML. Projector has no other way to your data. Nothing renders in the browser.
- **Buttons call your tools.** A click goes through the server's own `tools/call` handler, so the same validation and the same handler run as when the agent calls the tool. Reads from the view take the same path, limited to read tools.
- **Pages check for changes.** Every open page asks every 5 seconds (`poll`), and straight after its own action. The server runs the view and sends HTML only if it changed. Changes from anywhere, by the agent, a person or the server itself, show up within one check.

## What `attach` adds

- A `ui://` resource holding the page shell: CSS and a small runtime.
- `_meta.ui.resourceUri` on the `attachTo` tools, for apps that support the MCP Apps extension. Not yet tested in any such app.
- A tool called `p_sync` that the page calls to check for changes. Only clients that support MCP Apps see it listed, marked app-only.
- One model-visible tool, `open_<name>_in_browser`, that sends the person a link to the UI ([web mode](web-mode.md)).

## One check

1. The page sends its `params` and a hash of what it shows (`p_sync` in an MCP Apps host, `/ui/sync` on the web).
2. The server runs the view as that viewer, which calls the read tools, and hashes the result.
3. Same hash: it answers "nothing new". Different: it sends the HTML, and the page updates in place, matching elements by `id` and briefly highlighting changed rows.
4. The page waits 5 seconds and checks again. A hidden tab doesn't check until it is shown again.

The server keeps nothing between requests: what a viewer is looking at (search text, page, open row) lives in their browser as `params`, and a browser carries the agent's own MCP credential in an encrypted cookie, checked by the server on every request. So any instance can answer any page, including on serverless hosts ([web mode](web-mode.md#deploying)).

## Limits

- Near real time, not instant: someone else's change takes up to 5 seconds to appear. Your own shows at once.
- Every check runs the view and its read tools, changed or not: about 720 times an hour for each open, visible tab. Keep read tools cheap, or raise `poll`.
- The whole view is sent when it changes, so page big lists (about 200 rows at most).
- The UI shows only what tools return. A tool that returns only text gives the UI text to parse.
- Not yet tried inside a real host. Still unconfirmed there: that the host hides `p_sync` from the model.
