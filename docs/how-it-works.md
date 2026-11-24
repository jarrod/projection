# How it works

An MCP server has two audiences. The model calls its tools. The people working with that model want to see what is going on and sometimes act directly. Projection serves the second audience from the same server and the same tools, without changing anything the model sees.

Three ideas carry the whole design:

- **UI = view(user, params).** The view is one server function. It reads your data and returns HTML. Nothing renders in the browser.
- **Actions are your existing tools.** A button with `tool: "pin_note"` runs the same handler the agent runs, through the server's own `tools/call` handler.
- **Live updates come from tool calls.** After any tool call, from the agent or a human, the view runs again for every open screen. For changes that happen outside a tool, call `ui.write()`.

## Where the UI appears

| Surface | How it is reached | Transport |
|---|---|---|
| MCP Apps hosts (Claude, ChatGPT, VS Code and others that support the extension) | The agent calls a tool listed in `attachTo`. The host sees `_meta.ui.resourceUri` on that tool, fetches the `ui://` resource and shows it in a sandboxed frame. | MCP: the frame calls tools through the host |
| A normal URL (optional, [web mode](web-mode.md)) | A single-use link minted by the server, usually sent through MCP URL elicitation so it never enters the model's context | HTTP: POST for actions and for the sync poll |

## What `ui.attach(server)` adds

| Added | Visible to the model? | Purpose |
|---|---|---|
| Resource `ui://<name>/app.html` | No | The shell: tokens, kit CSS and the browser runtime |
| `_meta.ui.resourceUri` on each `attachTo` tool | No (`_meta` is for hosts) | Tells the host to open the UI when that tool runs |
| Tool `p_sync` | No (`visibility: ["app"]`) | Renders the view, or waits up to 25 s for a change |
| Tool named by `web.tool` | **Yes**, and only if you ask for it | Sends the human a link to the web UI |

It also wraps `server.registerTool` and the server's request handlers so it can see every `tools/call`. Your configs and your handlers' results pass through unchanged. The only addition is `_meta` on `attachTo` tools.

## One update, step by step

The agent calls `add_note`:

1. The wrapped `tools/call` handler runs your handler and keeps its result.
2. It calls `write()`, which bumps a change counter and returns. The agent's call finishes without waiting for any UI work.
3. Every open screen has a `p_sync` call waiting with the counter it last saw. They all wake.
4. Each viewer sends its view params. Viewers with the same user and params share one render of the view.
5. The server compares the HTML's hash with the one the viewer sent. If it is the same, it answers with no HTML. Otherwise it sends the whole new HTML.
6. The runtime morphs the page in place, matching elements by id, and briefly highlights rows that changed.

A human click starts from the other side. The runtime calls your tool, your handler runs, and `write()` fires the same way. The person who clicked sees the result when the next sync returns, which is right away because the counter moved.

The server keeps no per-viewer state. `p_sync` is a pure function of the user, the view params and one change counter.

## What triggers an update

- **Every tool call** except `p_sync` and tools annotated `readOnlyHint: true`, from the agent or a human.
- **`ui.write()`**, called where data changes outside tools: a cron job, a webhook, a worker. A burst of writes wakes viewers once.

## The sync poll

The runtime long-polls `p_sync` with its params, the hash of what it shows and the counter it last saw. The server holds the call up to 25 s, then answers with a counter and, if the HTML differs, the new HTML. The web runtime uses `POST /sync` the same way. There is no SSE.

The runtime paces itself to about one poll a second if the server answers at once with nothing new.

## The morph

Elements are matched by id, which is why every repeating element needs a stable, page-unique id. Changed rows get `p-updated` for 900 ms, which the kit shows as a highlight. `p-flash` on an element flashes it as a unit.

When an element without an id disappears, the unkeyed siblings after it are rebuilt, and an input there loses focus and text. Ids avoid this.

## What the browser keeps between updates

There is no client JavaScript besides the runtime, but the runtime keeps what a person did:

- Text typed, boxes ticked and options selected survive updates unless the server changes that field's value.
- Open popovers (`Dialog`, `Menu`) and `<details open>` stay open. Give them an `id`.
- `Tabs` keeps the selected tab.
- An element marked `p-keep` is never touched by the morph. It then never receives updates.
- State that should change what the view renders is a param, changed with `set`. See [Views and actions](views-and-actions.md#view-state-needs-no-tools).

## Cost and size

- The shell is small: the MCP runtime is under 2.5 KB gzipped and the kit CSS under 4 KB. Your `css` adds to it.
- After a change, the view runs once for each distinct (user, params) being watched. Viewers with the same pair share one render, so a view that is expensive for one viewer is not more expensive for many.
- Unchanged HTML isn't sent. Changed HTML is sent whole: the morph keeps DOM changes small, but the bytes are the view's size. A 500-row table resends 500 rows when one changes.
- So for big collections, show the most recent or most relevant N rows (about 200 at most) and add a page or limit param.
- Keep the view fast. A slow data read slows every viewer, not the agent.

## Limits

- **Several instances.** A change on one instance reaches viewers on another only when their poll times out (up to 25 s).
- **Web mode is in memory.** Links and sessions live in one process. It needs one instance or sticky routing, and a restart ends every browser session.
- **Not yet run inside a real host.** Unverified there: that `visibility: ["app"]` is honoured, and that a held `p_sync` call (up to 25 s) is tolerated.
- **Whole-view updates.** Very large views would want per-region updates, which projection doesn't do.
