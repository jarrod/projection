# Troubleshooting

Find the symptom, check the cause, apply the fix. Confirm each fix with the test and a fresh preview.

## Integration

| Symptom | Cause | Fix |
|---|---|---|
| Warning: `writes lists "t" but no tool "t" was registered after ui.attach()` | Tool registered before `ui.attach`, registered with `server.tool()`, or misspelled | Wrap construction: `ui.attach(new McpServer(...))` before any `registerTool`; convert `server.tool()` to `registerTool` with the same description, schema and annotations |
| Agent calls don't update the UI | Same as above, or the tool isn't in `writes`, or it writes a key the fragment doesn't read | Add `tool: [keys]`; check the fragment calls `read(key)` for that key |
| `ui.attach() was already called for this server.` | `attach` called twice on one instance | Once per server instance; call it where the instance is created |
| `Tool p_mount is already registered` | Two `defineUi` UIs attached to one server | One `ui` per server; put both screens in one UI (tabs, separate fragments) |
| `Tool <x> is already registered` for a `ui_*` tool | App-only tool registered twice (for example in a per-session factory and at module level) | Register it in the factory only |
| No UI appears in the host | Tool isn't in `attachTo`, or the host doesn't support MCP Apps | Add the tool to `attachTo`; check `t.resourceUri` in a test; try web mode |
| The snapshot comparison fails | An existing tool's config changed | Undo the change. `_meta.ui.resourceUri` is expected and ignored; anything else isn't |
| `mcp-projection` imports fail after install | `dist/` wasn't built | See SKILL.md step 3: build a tarball and install it |

## Actions

| Symptom | Cause | Fix |
|---|---|---|
| Click shows `UI may not call "t". Add it to defineUi({ writes }).` | Tool isn't in `writes` | Add it, with the keys it changes |
| Dev warning: `uses hx-tool="t", but "t" is not in defineUi({ writes })` | Same | Same |
| Click does nothing and shows no error; handler says "Not found" | The handler got `"7"` where it compared with `7`: UI calls skip zod coercion | Send ids in `args` (numbers stay numbers), not form fields |
| Handler gets `undefined` for a parameter with `.default()` | UI calls skip zod defaults | Send the value from the UI (`args` or a field) |
| Bad data stored after a UI call | UI calls skip validation; anyone can send any arguments to a `writes` tool | Validate in the handler, or route the UI through an app-only tool that validates |
| The action failed but nothing turned red | The tool returned `isError` instead of throwing | App-only twin tool that throws (recipes.md, recipe 6) |
| A no-argument tool breaks only when clicked | It has no `inputSchema`, so the UI passes args where `extra` was expected | Use an app-only tool for the UI |
| The click works in a host but not on the web | The handler reads `extra` fields web mode doesn't provide (`sendNotification`, `signal`, `sessionId`, `authInfo.clientId`, a token) | Read identity from `authInfo.extra.sub`; don't offer that action on the web |
| Search box calls the tool on every key with no pause | `debounce` missing | `Input({ tool, debounce: 250 })` |
| The form stays filled after submit | `keepValues` set, or the call threw | Remove `keepValues`; check `p-error` |
| The dialog stays open after submit | `close: true` missing on the `Form` | Add it |

## Rendering and updates

| Symptom | Cause | Fix |
|---|---|---|
| Agent tool calls fail with a message from your UI code | A loader or fragment threw during the render pass the write triggered | Make loaders and fragments total; `try`/`catch` and render a fallback (recipe 13) |
| `No loader for "k"` | `read("k")` without `load.k` | Add the loader or fix the key |
| `Unknown fragment "x"` | `frag("x")` or `root` names an undefined fragment | Define it, or fix the name |
| Per-row fragment content appears above the table, or rows lose their cells after an update | Fragment boundary inside `<table>` | Make the table one fragment, or use a list/grid |
| Only the first of two identical widgets updates | Same fragment mounted twice with the same params | Different params, or render it once |
| Rows in one of two tables never update | Both tables use the same `id`, so row ids collide | Give each table its own `id` |
| Every row flashes on each change | Repeating elements have no ids | `Table({ id, rowKey })`; `id` on each `li` or card |
| Everything re-renders on every write | The root fragment reads data | Move `read` calls into leaves |
| A `0` appears on the page | `` ${n && html`...`} `` with `n === 0` | `${n > 0 && ...}` |
| Raw HTML tags show as text | A string of HTML interpolated into `html` (escaped on purpose) | Build it with `html`, or `raw()` if it's trusted |
| An empty slot or border appears in a card header | `actions: cond && x` passes `false`, which isn't `null` | `actions: cond ? x : undefined` |
| Tab or toggle state resets on update | Hand-built toggle outside `p-local` | Wrap it in an element with `p-local`, or use `Tabs` |
| A `<script>` in a fragment never runs | By design: no client JavaScript | Use components, popovers, `<details>` or a server tool |

## Styling

| Symptom | Cause | Fix |
|---|---|---|
| Colours wrong in dark mode | Hard-coded colours in `css` or inline styles | Use `--p-*` tokens |
| Images or web fonts missing on the web | CSP allows only same-origin and `data:` images, no external fonts | Inline SVG, `data:` URIs, `Icon` |
| Layout overflows in a host | Too many table columns or fixed widths | Fold secondary fields under the title; drop columns; check at 420 px |
| Row action buttons aren't right-aligned | A flex `Row` ignores the column's `align: "right"` | `` html`<div class="row" style="justify-content:flex-end">...</div>` `` |
| Everything unstyled after `bare: true` | Kit CSS removed, including runtime rules | Add your own CSS, including `p-f { display: contents }` |

## Testing

| Symptom | Cause | Fix |
|---|---|---|
| Test process hangs for about 25 s at the end | A pending long-poll timer on the server | End with `process.exit()` |
| `until() timed out` though the data changed | The text also matches somewhere else (an activity feed), or the write isn't wired | Assert on an element id in `view.html()`; check `writes` |
| State from one test leaks into the next | Store is module-level (shared by both `testUi` servers, as intended) | Reset the store between tests, or use a fresh process |
| A narrow screenshot looks cut off on the right | Headless Chrome lays out at least 500 px wide and crops | Screenshot the iframe wrapper from assets/preview.mjs with a 520 px window |
