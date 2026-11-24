# mcp-projection API reference (0.3)

Every option, member, component, attribute and error message. Everything is imported from `"mcp-projection"` except the test harness (`"mcp-projection/testing"`).

## Contents

- [defineUi options](#defineui-options)
- [The ui object](#the-ui-object)
- [View and params](#view-and-params)
- [HTML helpers](#html-helpers)
- [Components](#components)
- [Runtime attributes and states](#runtime-attributes-and-states)
- [How UI calls reach your handler](#how-ui-calls-reach-your-handler)
- [Live updates](#live-updates)
- [What attach registers](#what-attach-registers)
- [Styling](#styling)
- [Web mode](#web-mode)
- [Test harness](#test-harness)
- [Preview CLI](#preview-cli)
- [Tool snapshot script](#tool-snapshot-script)
- [Errors](#errors)

## defineUi options

```ts
const ui = defineUi({ name, view, attachTo?, css?, bare?, identify?, uri?, web? });
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | `string` | required | Short name; resource URI is `ui://<name>/app.html` |
| `view` | `({ user, params }) => Html \| Promise<Html>` | required | The whole UI. Must return `` html`...` `` |
| `attachTo` | `string[]` | none | Existing tools whose results open the UI in MCP Apps hosts (adds `_meta.ui.resourceUri`) |
| `css` | `string` | none | CSS appended after the kit. Unlayered, so it wins. Must not contain `</style` |
| `bare` | `boolean` | `false` | Drop the tokens and the kit CSS |
| `identify` | `(extra) => string` | `extra.authInfo.extra.sub`, or `"local"` with no auth | User id for an MCP request. Returning nothing throws |
| `uri` | `string` | `ui://<name>/app.html` | Override the resource URI |
| `web` | `WebOptions & { tool?, toolDescription? }` | none | Also serve on a URL (see Web mode) |

## The ui object

| Member | Meaning |
|---|---|
| `ui.attach(server)` | Wraps `server.registerTool` and the request handlers, registers the resource and `p_sync`. Returns `server`. Call before any tool is registered, once per server instance. Throws otherwise |
| `ui.write()` | Signal that data changed outside a tool call (cron, webhook, queue). Tool calls do this by themselves. A burst of writes wakes viewers once |
| `ui.render(params = {}, user = "local")` | HTML string of the view wrapped in `<p-f id="p-root">`. For tests and snapshots |
| `ui.preview(params?, { user?, theme? })` | Standalone HTML document with the CSS and no runtime. `theme: "light" \| "dark"` |
| `ui.sync(user, { params, h, v }, waitMs = 25000, signal?)` | What `p_sync` calls: wait for a change if `v` is current, return `{ v, h }` or `{ v, h, html }` |
| `ui.identify(extra)` | The user id for an MCP request, as the view receives it. Use it in tool handlers |
| `ui.site` | Web site object when `web` is set, else `undefined` |
| `ui.link(extra, server)` | Mint a single-use web link for the user behind an MCP request. Needs `web` and the attached server. Returns the URL |
| `ui.openInBrowser(extra, { server, message? })` | From inside a tool handler: mint a link and ask the host to open it (URL elicitation). Returns `{ opened, declined, url }`. Without elicitation support it returns the url and neither flag |
| `ui.uri` | The resource URI |
| `ui.shell()` | The resource HTML |

Create one `ui` per server codebase, at module level. A second `ui.attach` on the same server throws.

## View and params

```ts
view: async ({ user, params }) => html`...`
```

| Context | Meaning |
|---|---|
| `user` | The MCP user: `authInfo.extra.sub`, or `"local"` with no auth |
| `params` | `Record<string, any>` kept in the viewer's browser and sent with each sync. `{}` at first. Untrusted: any value can be any JSON type. Read as `String(params.q ?? "")` |

- The view runs again after every tool call except `p_sync` and tools annotated `readOnlyHint: true`.
- Viewers asking for the same (version, user, params) share one render.
- Params change with `set` on a `Button`, `Input`, `Select`, `Form` or `Menu` item, and reset when the UI is reopened.
- The server keeps no per-viewer state. `p_sync` is a function of (user, params) plus one change counter.
- Split a big view into plain functions that return `html`. There is nothing to register.

## HTML helpers

| Helper | Meaning |
|---|---|
| `` html`...` `` | Tagged template. Values are escaped; `Html` values and arrays are inlined; `null`, `undefined`, `false`, `true` render nothing; numbers render (including `0`) |
| `raw(s)` | Mark a string as trusted HTML. A JSON `{ __html }` object is escaped, not trusted |
| `esc(v)` | Escape to a string |
| `attrs(obj)` | Attributes: `true` gives a bare attribute, `false`/`null`/`undefined` are omitted, objects become JSON. Names that are not valid are dropped |
| `cx(...classes)` | Join truthy class names |
| `type Html` | `{ __html: string }` |

## Components

All return `Html`. Children are extra arguments (strings, numbers, `Html`, arrays).

**Action props** (on `Button`, `Form`, `Input`, `Textarea`, `Select`, `Checkbox`, menu items):

- `tool?: string`: call this tool.
- `args?: Record<string, unknown>`: merged last, keeps JSON types.
- `set?: Record<string, unknown> | true`: instead of a tool, merge these values into the view params and render again. `true` on an `Input`, `Select` or `Form` sets its own fields.
- `close?: boolean`: close the surrounding dialog or menu on success (applies with `tool` or `set`).

### Layout

| Signature | Props |
|---|---|
| `Stack(props, ...kids)` | `gap?` px (default 12) |
| `Row(props, ...kids)` | `gap?` px (default 8), `between?` |
| `Grid(props, ...kids)` | `min?` px column width (default 180), `gap?` |
| `Separator()` | |
| `Header({ title, description?, actions? })` | |
| `Card(props, ...kids)` | `title?`, `description?`, `actions?`, `footer?`, `flush?` (no body padding), `id?` |

### Controls

| Signature | Props | Sends |
|---|---|---|
| `Button(props, ...kids)` | `variant?: "primary" \| "secondary" \| "ghost" \| "danger"`, `size?: "sm" \| "md"`, `icon?`, `label?` (accessible name for icon-only), `opens?` (popover id), `type?: "button" \| "submit"`, `disabled?`, `id?` + action props | `args` |
| `Form(props, ...kids)` | `id?`, `keepValues?` + action props | on submit: all named fields (text as strings, checkboxes as booleans), then `args`. Resets on success unless `keepValues` |
| `Input(props)` | `name`, `label?`, `hint?`, `required?`, `placeholder?`, `disabled?`, `type?`, `value?`, `autofocus?`, `debounce?` + action props | with `tool`: `{ [name]: string }` + `args`, on change, or as you type with `debounce`. With `set: true`: the same into params |
| `Textarea(props)` | as `Input`, plus `rows?` (no `type`, no `autofocus`) | same as Input |
| `Select(props)` | `name`, `options: (string \| { value, label })[]`, `value?`, `label?`, `hint?`, `disabled?` + action props | `{ [name]: string }` + `args`, on change |
| `Checkbox(props)` | `name`, `label?`, `checked?`, `switch?`, `disabled?` + action props (no `placeholder`) | `{ [name]: boolean }` + `args`, on change |

A `Button` with no children and an `icon` is icon-only. A `Button` with no `tool`, `set` or `opens` inside a `Form` submits the form. `opens` can be combined with `tool` or `set` (open the dialog for this row).

### Display

| Signature | Props |
|---|---|
| `Badge(props, ...kids)` | `tone?`, `outline?`, `dot?` |
| `Dot(props)` | `tone?`, `pulse?`, `label?` (accessible name) |
| `Stat({ label, value, delta?, tone? })` | `tone` colours the stat |
| `Table<T>({ id?, rows, columns, rowKey?, empty? })` | Row ids `${id}-${rowKey(row)}`. Empty `rows` with `empty` renders `empty` only |
| `Empty({ title, description?, action?, icon? })` | |
| `Skeleton({ lines?, width? })` | |
| `Kbd(key)`, `Muted(...kids)`, `Mono(...kids)` | |
| `Icon(name)` | `plus check x more chevron down search trash pin external refresh sun moon monitor` |

Column: `{ label: string; key?: keyof T; cell?: (row: T) => unknown; align?: "left" | "right"; mono?: boolean; width?: string }`.

Tones: `"neutral" | "ok" | "warn" | "bad" | "info"` (`type Tone`).

### Overlays and tabs

| Signature | Notes |
|---|---|
| `Dialog({ id, title, description? }, ...kids)` | Native popover. Open with `Button({ opens: id })`. Put buttons in `` html`<div class="actions">...</div>` `` |
| `Close(id, label = "Cancel")` | Secondary button that hides the popover |
| `Menu({ id, items })` | Items: `{ label, icon?, kbd?, danger?, href?, tool?, args?, set?, close? }` or `"-"`. Action items close the menu by default. `href` must be http(s), mailto or relative; it opens in a new tab. A plain list of buttons and links (no `role="menu"`) |
| `Tabs({ id, tabs: { label, content }[], selected? })` | Up to 6 tabs. Selection stays in the browser across updates |
| `ThemeToggle()` | System, light or dark. Pure CSS. Hidden in hosts that set a theme. Use once per view |

## Runtime attributes and states

Components set these; use them directly in hand-written HTML. These are the only ones. The `hx-` names are borrowed from htmx but this is not htmx: `hx-get`, `hx-target`, `hx-swap` and trigger modifiers do nothing.

| Attribute | Meaning |
|---|---|
| `hx-tool="name"` | Call this tool. Default trigger: submit for forms, change for inputs/selects/textareas, click otherwise |
| `p-set` | Instead of a tool: merge the element's values (and `hx-vals`) into the view params |
| `hx-vals='{"id":1}'` | Extra args or params as JSON (use `attrs({ "hx-vals": {...} })`) |
| `hx-trigger="input"` + `p-debounce="300"` | Act while typing. `hx-trigger` accepts click, submit, change, input |
| `p-close` | Close the surrounding popover after success |
| `p-keep-values` | Don't reset the form after success |
| `p-keep` | Never morph this element (it also never receives updates) |
| `p-flash` | Flash this element as a unit when something inside changes |

Set by the runtime:

- `aria-busy="true"` while calling (ignores clicks, spinner on buttons).
- `p-error="message"` after a failed call, on the field's label if it has one. The kit shows it in red. The next attempt clears it.
- `p-updated` for 900 ms on the nearest changed `tr`, `li`, `.stat` or `[p-flash]`.
- `p-ready` on the document element after the first render.

A control whose call failed goes back to what the server last rendered. What a person typed, ticked or selected survives updates unless the server changes that field's value. The morph matches elements by id, keeps open popovers and `<details open>`.

## How UI calls reach your handler

- In hosts: the runtime calls the tool with `tools/call`, the same request an agent sends. In web mode: `POST <base>/tool/<name>`.
- The call goes through the server's own `tools/call` handler. Zod validation, coercion and defaults run. Output schemas are checked.
- A form sends text fields as strings and checkboxes as booleans. For a number use `z.coerce.number()` or pass it in `args`.
- `extra` in hosts is that request's `extra` (same `authInfo`). In web mode it carries the `authInfo` of the MCP request that minted the link, but cannot send notifications or requests.
- A returned `{ isError: true }` shows as `p-error` with the first text content. A thrown error does too.
- Hosts see the new view through the open `p_sync` poll. The tool's own result is not patched into the page.
- Annotate tools that change nothing with `readOnlyHint: true`: their calls don't wake viewers.

## Live updates

- Every tool call except `p_sync` and `readOnlyHint` tools calls `write()` after it returns. `write()` bumps a counter and wakes waiting viewers once per burst, after the caller has moved on.
- The runtime long-polls `p_sync` with `{ params, h, v }` (hash of what it shows, counter it last saw). The server holds the call up to 25 s when `v` is current, then returns `{ v, h }` or, if the hash differs, `{ v, h, html }`.
- The runtime paces itself to about one poll a second if the server answers at once with nothing new.
- With several instances, a change on one reaches viewers on another when their poll times out (up to 25 s).

## What attach registers

| Item | Model-visible |
|---|---|
| Resource `ui://<name>/app.html` (`text/html;profile=mcp-app`) | no |
| `_meta.ui.resourceUri` on `attachTo` tools | no (`_meta`) |
| `p_sync`, `visibility: ["app"]` | no |
| `web.tool`, if set | **yes** |

## Styling

Two cascade layers: `tokens.css` holds the design tokens and `kit.css` styles the components with them. Token values are `light-dark(...)` pairs that fall back to MCP Apps host variables, so the UI follows the host theme.

Tokens: `--p-bg --p-bg-2 --p-bg-3` (background), `--p-fg --p-fg-2 --p-fg-3` (text), `--p-line --p-line-2` (borders), `--p-inv --p-inv-fg` (primary button), `--p-ring` (focus, flash), `--p-ok --p-warn --p-bad --p-info` (tones), `--p-r --p-r-sm` (radius), `--p-font --p-mono`, `--p-shadow`, `--p-edge`, `--p-ease`.

- `css` is unlayered, so it always wins: `css: ":root { --p-r: 6px }"`.
- Themes: `themes.terminal` (black, monospace, square) and `themes.pop` (bright, rounded). Combine with your own rules: `` css: themes.terminal + `:root { --p-bg: #050505 }` ``.
- `bare: true` drops tokens and kit. `css: TOKENS + myKit` keeps the tokens (both are exported) and replaces the components. Then you also own `p-f { display: contents }`, the `[p-updated]` flash, `[aria-busy]` and `[p-error]`.
- Utility classes: `stack row between grid grow muted subtle mono sm xs`; `.actions` inside dialogs; layout reads `--gap` and `--min` from inline styles.
- Light and dark: the host's `data-theme` wins, then `ThemeToggle()`, then the OS.
- External images, fonts and stylesheets are blocked in web mode (CSP) and projection declares no extra domains to hosts. Use inline SVG and `data:` URIs.

## Web mode

```ts
defineUi({ ..., web: { origin: "https://app.example.com", tool: "open_notes_in_browser" } });
http.createServer((req, res) => ui.site!.node(req, res)).listen(3000);
```

| `web` option | Default | Meaning |
|---|---|---|
| `origin` | required | Public origin the browser uses; links are `<origin><base>/l/<token>` |
| `base` | `"/ui"` | Mount path |
| `linkTtl` | `120` | Seconds a link stays redeemable (once) |
| `sessionTtl` | `3600` | Seconds a browser session lasts, never longer than the MCP auth it came from |
| `tool` | none | Register a **model-visible** tool that opens the UI for the caller (URL elicitation; falls back to returning the link as text) |
| `toolDescription` | generated | Description for that tool |

| `ui.site` member | Meaning |
|---|---|
| `fetch(request)` | `Promise<Response \| null>`; `null` when the path is outside `base`. Leaves compression to the platform |
| `node(req, res, next?)` | Node adapter; compresses with brotli or gzip. Passes other paths to `next()` with the body unread, else 404. Answers 413 over 1 MB and 500 on error. Mount before body parsers, at the app root |
| `revoke(user)` | End all links and sessions for a user |
| `close()` | Stop the expiry sweep |

Links come from `web.tool`, or from `ui.link(extra, server)` and `ui.openInBrowser(extra, { server })` inside a tool handler. `server` is the attached `McpServer` handling the request: the browser session's tool calls run on it.

Flow: GET on a link shows a Continue page; POST redeems it (403 from another site), sets an HttpOnly, SameSite=Lax cookie scoped to `base` (Secure on https) and redirects to `<base>/`. Requests need the `P-Req: 1` header. One session holds up to 8 open views; a ninth replaces the oldest. Strict CSP, `no-referrer`, `no-store`. Tokens are stored hashed.

Web tool calls get `extra.authInfo` but can't send notifications or requests, and `ui.link` and `ui.openInBrowser` throw there. Links and sessions are in memory: one instance or sticky routing, and a restart ends every browser session.

## Test harness

```js
import { testUi } from "mcp-projection/testing";
const t = await testUi(createServer);   // factory is called twice: an agent client and a host client
```

| Member | Meaning |
|---|---|
| `t.agent`, `t.host` | MCP `Client`s |
| `t.tools` | All tools, including app-only |
| `t.modelTools` | Tools the model sees |
| `t.resourceUri` | First `_meta.ui.resourceUri` found |
| `t.mount(params?)` | Mount with optional view params and keep syncing; returns a view |
| `t.close()` | Close both clients |
| `view.html()`, `view.text()` | Current HTML and its visible text |
| `view.click(tool, args)` | Call a tool like an `hx-tool` click; returns the result; throws if the tool errors. Doesn't check a matching element exists |
| `view.set(params)` | Merge view params like a `set` control, then render again |
| `view.until((text, html) => boolean, ms = 2000)` | Wait for the UI to match |
| `view.close()` | Stop syncing |

End the script with `process.exit()`: a pending server-side long-poll can hold Node open for 25 s.

## Preview CLI

```bash
npx mcp-projection preview dist/ui.js ['{"q":"x"}'] [--dark|--light] [--user=id] > preview.html
```

The module must export `ui` (or default-export it). The page has the CSS and no runtime. The view runs in a fresh process, often with an empty store; seed data with a script calling `ui.preview()` instead ([assets/preview.mjs](../skills/mcp-projection/assets/preview.mjs)).

## Tool snapshot script

`scripts/tool-snapshot.mjs` in the skill (installed at `node_modules/mcp-projection/skills/mcp-projection/scripts/`) connects as a plain MCP client and records every model-visible tool, everything except `_meta`. Run it from the server's project folder, which is where it finds the SDK.

```bash
node tool-snapshot.mjs --out before.json -- node dist/index.js            # before the UI
node tool-snapshot.mjs --compare before.json -- node dist/index.js        # after
node tool-snapshot.mjs --url http://localhost:3000/mcp --compare before.json
```

| Flag | Meaning |
|---|---|
| `-- <command>` | Start the server with this command over stdio |
| `--url <url>` | Connect to a running Streamable HTTP server instead |
| `--out <file>` | Write the snapshot (default: print it) |
| `--cwd <dir>` | Where to run the command and find the SDK (default: `.`) |
| `--compare <file>` | Compare with a snapshot. A changed or missing tool, or a different call result, exits 1. New model-visible tools are listed but allowed, since `web.tool` adds one on purpose |
| `--strict` | With `--compare`, new model-visible tools fail too |
| `--calls <file>` | A JSON array of `[toolName, args]` whose results are recorded too. List only calls that are safe against the server's data |

## Errors

| Message | Fix |
|---|---|
| `` view must return html`...`. `` | Return an `html` template (or a component), not a string |
| `ui.attach(server) must be called before any tool is registered on the server.` | Attach first |
| `ui.attach() was already called for this server.` | Attach once per server instance |
| `This @modelcontextprotocol/sdk version is not supported: tools/call handler not recognised.` | Use an SDK 1.20 or later `McpServer` |
| `No user id: set authInfo.extra.sub in your token verifier, or return one from defineUi({ identify }).` | Authenticated request without a subject |
| `css must not contain </style` | Remove it from `css` |
| `ui.link(extra, server) needs defineUi({ web: { origin } }) and the attached server.` | Configure `web`, pass the attached server |
| `Not available from the web UI.` | `ui.link`/`openInBrowser` called from a web session |
