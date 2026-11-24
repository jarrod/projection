<!-- Copied from docs/troubleshooting.md by build.mjs. Edit that file. -->
# Troubleshooting

Find the symptom, check the cause, apply the fix. Confirm each fix with the test and a fresh preview.

## Integration

| Symptom | Cause | Fix |
|---|---|---|
| `ui.attach(server) must be called before any tool is registered on the server.` | A tool was registered before `attach` | Wrap construction: `ui.attach(new McpServer(...))`, then register tools |
| `ui.attach() was already called for this server.` | `attach` called twice on one instance | Once per server instance; call it where the instance is created |
| `This @modelcontextprotocol/sdk version is not supported: tools/call handler not recognised.` | The SDK is older than 1.20 or changed its internals | Upgrade the SDK |
| `Tool p_sync is already registered` | Two `defineUi` UIs attached to one server | One `ui` per server; put both screens in one view (tabs, a param) |
| No UI appears in the host | Tool isn't in `attachTo`, or the host doesn't support MCP Apps | Add the tool to `attachTo`; check `t.resourceUri` in a test; try web mode |
| Agent calls don't update the UI | The tool is annotated `readOnlyHint: true`, or the data changed outside a tool | Drop the annotation if it writes; call `ui.write()` for changes outside tools |
| The snapshot comparison fails | An existing tool's config changed | Undo the change. `_meta.ui.resourceUri` is expected and ignored; anything else isn't |
| `mcp-projection` imports fail after install | `dist/` wasn't built | Build a tarball and install that: clone the repository, `npm install && npm run build && npm pack`, then `npm install` the `.tgz` |

## Actions

| Symptom | Cause | Fix |
|---|---|---|
| The action failed and the control shows `p-error` | The handler threw, returned `isError`, or zod rejected the input | Read the message in the tool result. Fix the args the control sends |
| A number arrives as a string | Form fields and `Select` send text | `z.coerce.number()` in the schema, or send the number in `args` |
| A checkbox arrives as a boolean, the schema expects a string | Checkboxes send `true` or `false` | Match the schema, or map it in the handler |
| Search box calls the tool on every key | `debounce` missing | `Input({ tool, debounce: 250 })`, or use `set: true` and read the param in the view |
| The form stays filled after submit | `keepValues` is set, or the call failed | Remove `keepValues`; check `p-error` |
| The dialog stays open after submit | `close: true` missing on the `Form` | Add it |
| The click works in a host but not on the web | The handler reads `extra` fields web mode doesn't provide (`sendNotification`, `sendRequest`, a client id) | Read identity with `ui.identify(extra)`; don't offer that action on the web |
| Express web routes 404 or get an empty body | `site.node` is mounted under a path, or after a body parser | Mount it at the app root, before body parsers |
| Every viewer sees the same data | No authentication, so every viewer is `"local"`. Params stay per browser | Add auth and filter by `user`, or accept it for a single-user server |
| Bad data stored after a UI call | Validation is only what the schema checks | Tighten the schema. UI calls run the same zod validation as agent calls |

## Rendering and updates

| Symptom | Cause | Fix |
|---|---|---|
| `` view must return html`...`. `` | The view returned a string, `undefined` or a component's raw output of another type | Return an `html` template. Wrap strings with `html` or `esc` |
| A viewer sees an error or an old screen, agent calls are fine | The view threw. Only that viewer's sync fails | Make the view total: `try`/`catch` around data reads and render a fallback ([recipes.md](../references/recipes.md), "A view that can't throw") |
| Params are `undefined` or the wrong type | Params are untrusted and start empty | `String(params.q ?? "")`; clamp numbers; check against an allowed list |
| The page filter resets when the UI reopens | Params live in the browser and reset on reopen | By design. Keep durable state in your store behind a tool |
| Every row flashes on each change | Repeating elements have no ids | `Table({ id, rowKey })`; an `id` on each `li` or card |
| Rows in one of two tables never update | Both tables use the same `id`, so row ids collide | Give each table its own `id` |
| A `0` is missing | `0` renders, but `${n && html`...`}` shows it where you wanted nothing | `${n > 0 && html`...`}` |
| Raw HTML tags show as text | A string of HTML interpolated into `html` (escaped on purpose) | Build it with `html`, or `raw()` if it's trusted |
| An empty slot or border appears in a card header | `actions: cond && x` passes `false` | `actions: cond ? x : undefined` |
| A hand-built toggle resets on update | State outside the DOM the runtime keeps | Use `Tabs`, `<details>` with an `id`, or a param with `set` |
| A `<script>` in the view never runs | By design: no client JavaScript | Use components, `<details>`, params or a tool |

## Styling

| Symptom | Cause | Fix |
|---|---|---|
| Colours wrong in dark mode | Hard-coded colours in `css` or inline styles | Use `--p-*` tokens |
| Images or web fonts missing on the web | CSP allows only same-origin and `data:` images, no external fonts | Inline SVG, `data:` URIs, `Icon` |
| Layout overflows in a host | Too many table columns or fixed widths | Fold secondary fields under the title; drop columns; check at 420 px |
| Row action buttons aren't right-aligned | A flex `Row` ignores the column's `align: "right"` | `` html`<div class="row" style="justify-content:flex-end">...</div>` `` |
| Everything unstyled after `bare: true` | Tokens and kit CSS removed | Add your own CSS, including `p-f { display: contents }` |

## Testing

| Symptom | Cause | Fix |
|---|---|---|
| Test process hangs for about 25 s at the end | A pending long-poll timer on the server | End with `process.exit()` |
| `until() timed out` though the data changed | The text also matches elsewhere (an activity feed), or the change isn't reaching the view | Assert on an element id in `view.html()`; check the tool isn't `readOnlyHint` |
| `click` throws | The tool returned an error | Read the message. `click` throws on any error result |
| State from one test leaks into the next | The store is module-level (shared by both servers `testUi` creates, as intended) | Reset the store between tests, or use a fresh process |
| A narrow screenshot looks cut off on the right | Headless Chrome lays out at least 500 px wide and crops | Screenshot the iframe wrapper from [assets/preview.mjs](../assets/preview.mjs) with a 520 px window |
