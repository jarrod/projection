# Troubleshooting

Find the symptom, check the cause, apply the fix.

## Integration

| Symptom | Cause | Fix |
|---|---|---|
| `ui.attach(server) must be called before any tool is registered on the server.` | A tool was registered before `attach` | Wrap construction: `ui.attach(new McpServer(...))`, then register tools |
| `ui.attach() was already called for this server.` | `attach` called twice on one instance | Once per server instance; call it where the instance is created |
| `This @modelcontextprotocol/sdk version is not supported: tools/call handler not recognised.` | The SDK is older than Projection's `peerDependencies` allow, or changed its internals | Upgrade the SDK |
| `Tool p_sync is already registered` | Two `defineUi` UIs attached to one server | One `ui` per server; put both screens in one view (tabs, a param) |
| No UI appears in the host | Tool isn't in `attachTo`, or the host doesn't support MCP Apps | Add the tool to `attachTo`; check `t.resourceUri` in a test; try web mode |
| Agent calls don't update the UI | The tool is annotated `readOnlyHint: true`, or the data changed outside a tool | Drop the annotation if it writes; call `ui.write()` for changes outside tools |
| `mcp-projection` imports fail after install | `dist/` wasn't built | Build a tarball and install that: clone the repository, `npm install && npm run build && npm pack`, then `npm install` the `.tgz` |

## Actions

| Symptom | Cause | Fix |
|---|---|---|
| The action failed and the control shows `p-error` | The handler threw, returned `isError`, or zod rejected the input | Read the message in the tool result. Fix the args the control sends |
| A number arrives as a string | Form fields and `Select` send text | `z.coerce.number()` in the schema, or send the number in `args` |
| Search box calls the tool on every key | `debounce` missing | `Input({ tool, debounce: 250 })`, or use `set: true` and read the param in the view |
| The click works in a host but not on the web | The handler reads `extra` fields web mode doesn't provide (`sendNotification`, `sendRequest`, a client id) | Read identity with `ui.identify(extra)`; don't offer that action on the web |
| Express web routes 404 or get an empty body | `site.node` is mounted under a path, or after a body parser | Mount it at the app root, before body parsers |
| Every viewer sees the same data | No authentication, so every viewer is `"local"`. Params stay per browser | Add auth and filter by `user`, or accept it for a single-user server |

## Rendering and updates

| Symptom | Cause | Fix |
|---|---|---|
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
| Test process hangs for about 25 s at the end | A pending long-poll timer on the server | End with `process.exit()` |
| `until() timed out` though the data changed | The text also matches elsewhere (an activity feed), or the change isn't reaching the view | Assert on an element id in `view.html()`; check the tool isn't `readOnlyHint` |
| State from one test leaks into the next | The store is module-level (shared by both servers `testUi` creates, as intended) | Reset the store between tests, or use a fresh process |
