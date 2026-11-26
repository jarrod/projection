# Troubleshooting

Find the symptom, check the cause, apply the fix.

## Integration

| Symptom | Cause | Fix |
|---|---|---|
| `ui.attach(server) must be called before any tool is registered on the server.` | A tool was registered before `attach` | Wrap construction: `ui.attach(new McpServer(...))`, then register tools |
| `This MCP SDK version is not supported: tools/call handler not recognised.` | The SDK is outside Projector's `peerDependencies` | Install a supported version |
| `ui.attach() was already called for this server.` | `attach` called twice on one instance | Once per server instance; call it where the instance is created |
| `Tool p_sync is already registered` | Two `defineUi` UIs attached to one server | One `ui` per server; put both screens in one view (tabs, a param) |
| No UI appears in the host | Tool isn't in `attachTo`, or the host doesn't support MCP Apps | Add the tool to `attachTo`; check `t.resourceUri` in a test; try web mode |
| Agent calls don't update the UI | The tool is annotated `readOnlyHint: true` or listed in `reads` | Take it out of `reads` if it writes. A wrong annotation is the server's to fix |
| The UI lags behind changes by up to 5 seconds | Pages check on a cadence (`poll`, default 5 s) | Expected. Your own actions show at once. Lower `poll` if needed; every check runs the view's read tools |
| `web.secret must be at least 32 random characters...` | `origin` is set without a secret, or the secret is short | Set `web.secret` from an environment variable, the same on every instance |
| A used link works a second time | Several instances or a serverless host with the default `claim`, which remembers used links in one process | Give `web.claim` real storage: an insert with a unique key |
| `Set web.mcp...` when opening the UI | The server has auth, so browser requests must go through its MCP endpoint | Set `web.mcp` to the endpoint's URL, or to a function that handles it in this process |
| Browser actions fail with a 500 | `web.mcp` keeps MCP sessions, redirects, or doesn't answer within 30 seconds | Point `web.mcp` at a stateless endpoint that answers directly |
| The page says "ask the assistant again" | The server refused the agent's token: it expired or was revoked | Expected. Ask the agent to open the UI again |
| `web.origin must be https` | A plain http origin that isn't localhost | Serve the UI over https: the cookie carries the agent's token |
| `mcp-projector` imports fail after install | Installed from a branch or commit, which holds no `dist/` | Install a release tag instead: `github:jarrod/projector#v0.4.0` |

## Actions

| Symptom | Cause | Fix |
|---|---|---|
| The action failed and the control shows `p-error` | The handler threw, returned `isError`, or zod rejected the input | Read the message in the tool result. Fix the args the control sends |
| A number arrives as a string | Form fields and `Select` send text | `z.coerce.number()` in the schema, or send the number in `args` |
| Search box calls the tool on every key | `debounce` missing | `Input({ tool, debounce: 250 })`, or use `set: true` and read the param in the view |
| The click works in a host but not on the web | The handler uses context the web doesn't provide (`ctx.mcpReq.send`, `ctx.mcpReq.elicitInput`, a client id) | Don't offer that action on the web. Don't change the handler for the UI |
| Express web routes 404 or get an empty body | `site.node` is mounted under a path, or after a body parser | Mount it at the app root, before body parsers |
| Every viewer sees the same data | No authentication, so every viewer is `"local"`. Params stay per browser | Add auth and filter by `user`, or accept it for a single-user server |

## Rendering and updates

| Symptom | Cause | Fix |
|---|---|---|
| `The view can only call read tools: ...` | The view called a tool that isn't annotated `readOnlyHint` and isn't in `reads` | If it only reads, add it to `defineUi({ reads })`. If it changes data, use it from a button or form instead |
| `call needs a viewer: ...` | `ui.render()` or `ui.preview()` ran a view that calls tools, outside an MCP request or browser session | Render through `testUi`, which calls tools for real |
| The UI shows text instead of a table | The read tool returns only text | Parse `content[0].text`, or show it as text. Don't change the tool |
| `` view must return html`...`. `` | The view returned a string, `undefined` or a component's raw output of another type | Return an `html` template. Wrap strings with `html` or `esc` |
| A viewer sees an error or an old screen, agent calls are fine | The view threw. Only that viewer's sync fails | Make the view total: `try`/`catch` around data reads and render a fallback ([recipes](recipes.md#13-a-view-that-cant-throw)) |
| Params are `undefined` or the wrong type | Params are untrusted and start empty | `String(params.q ?? "")`; clamp numbers; check against an allowed list |
| Every row flashes on each change | Repeating elements have no ids | `Table({ id, rowKey })`; an `id` on each `li` or card |
| Rows in one of two tables never update | Both tables use the same `id`, so row ids collide | Give each table its own `id` |
| A stray `0` appears | `0` renders, so `` ${n && html`...`} `` prints it when `n` is 0 | `` ${n > 0 && html`...`} `` |
| Raw HTML tags show as text | A string of HTML interpolated into `html` (escaped on purpose) | Build it with `html`, or `raw()` if it's trusted |
| A hand-built toggle resets on update | State outside the DOM the runtime keeps | Use `Tabs`, `<details>` with an `id`, or a param with `set` |
| A `<script>` in the view never runs | By design: no client JavaScript | Use components, `<details>`, params or a tool |

## Styling

| Symptom | Cause | Fix |
|---|---|---|
| Colours wrong in dark mode | Hard-coded colours in `css` or inline styles | Use `--p-*` tokens |
| Images or web fonts missing on the web | CSP allows only same-origin and `data:` images, no external fonts | Inline SVG, `data:` URIs, `Icon` |
| Layout overflows in a host | Too many table columns or fixed widths | Fold secondary fields under the title; drop columns; check at 420 px |
| Row action buttons aren't right-aligned | A flex `Row` ignores the column's `align: "right"` | `` html`<div class="row" style="justify-content:flex-end">...</div>` `` |

## Testing

| Symptom | Cause | Fix |
|---|---|---|
| `until() timed out` though the data changed | The text also matches elsewhere (an activity feed), or the change isn't reaching the view | Assert on an element id in `view.html()`; check the tool isn't `readOnlyHint` or in `reads` |
| State from one test leaks into the next | The store is module-level (shared by both servers `testUi` creates, as intended) | Reset the store between tests, or use a fresh process |
