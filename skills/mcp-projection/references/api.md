# mcp-projection API reference (0.2)

Everything is imported from `"mcp-projection"` except the test harness (`"mcp-projection/testing"`).

## Contents

- [defineUi options](#defineui-options)
- [The ui object](#the-ui-object)
- [Fragments and data](#fragments-and-data)
- [HTML helpers](#html-helpers)
- [Components](#components)
- [Runtime attributes and states](#runtime-attributes-and-states)
- [How UI calls reach your handler](#how-ui-calls-reach-your-handler)
- [What attach registers](#what-attach-registers)
- [Styling](#styling)
- [Web mode](#web-mode)
- [Test harness](#test-harness)
- [Preview CLI](#preview-cli)
- [Dev warnings and errors](#dev-warnings-and-errors)

## defineUi options

```ts
const ui = defineUi({ name, load, writes?, attachTo?, readOnly?, root?, css?, bare?, identify?, uri?, dev?, web? });
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | `string` | required | Short name; resource URI is `ui://<name>/app.html` |
| `load` | `{ [key]: (ctx: { user: string; id?: string }) => T \| Promise<T> }` | required | Data the UI can read. Types flow into `read()` |
| `writes` | `{ [tool]: key[] }` | `{}` | After any call to `tool` (agent or UI), readers of these keys re-render. Unless `readOnly`, also the only tools the UI may call |
| `attachTo` | `string[]` | none | Existing tools whose results open the UI in MCP Apps hosts (adds `_meta.ui.resourceUri`) |
| `readOnly` | `boolean` | `false` | No `p_call`, smaller runtime, read-only web links |
| `root` | `string` | `"app"` | Root fragment name |
| `css` | `string` | none | CSS appended after the kit |
| `bare` | `boolean` | `false` | Drop the kit CSS entirely |
| `identify` | `(extra) => string` | `extra.authInfo.extra.sub` → `extra.authInfo.clientId` → `"local"` | User id for an MCP request |
| `uri` | `string` | `ui://<name>/app.html` | Override the resource URI |
| `dev` | `boolean` | `NODE_ENV !== "production"` | Development warnings |
| `web` | `{ origin, base?, linkTtl?, sessionTtl?, tool?, toolDescription? }` | none | Also serve on a URL (see Web mode) |

`writes` keys must be keys of `load`. They name whole keys; for one item, call `` ui.write(`note:${id}`) `` yourself.

## The ui object

| Member | Meaning |
|---|---|
| `ui.attach(server)` | Wraps `server.registerTool`, registers the resource and app-only tools. Returns `server`. Call before registering tools, once per server instance (throws if called twice on one server) |
| `ui.fragment(name, fn)` | Define a fragment. Returns `ui` (chainable) |
| `ui.write(...keys)` | Mark data changed from outside tools. `"notes"` refreshes readers of `notes` and every `notes:<id>`; `"note:42"` only readers of `read("note", 42)`. Returns a promise that resolves after the render pass |
| `ui.render(name = root, { user?, params? })` | HTML string of one fragment, wrapped in `<p-f id="...">`. For tests and snapshots |
| `ui.preview(name = root, { user?, params?, theme? })` | Standalone HTML document with the CSS and no runtime. `theme: "light" \| "dark"` |
| `ui.site` | Web site object when `web` is set, else `undefined` |
| `ui.openInBrowser(extra, { server, readOnly?, message? })` | From inside a tool handler: mint a link and ask the host to open it (URL elicitation). Returns `{ opened, declined, url }` |
| `ui.uri` | The resource URI |
| `ui.shell()` | The resource HTML |
| `ui.engine` | Internal engine (stats, advanced use) |

Create one `ui` per server codebase, at module level. Two `ui`s can't attach to one server.

## Fragments and data

```ts
ui.fragment("list", async ({ user, params, read, frag }) => html`...`);
```

| Context | Meaning |
|---|---|
| `user` | Viewer id |
| `params` | `Record<string, string>` from the parent's `frag(name, params)`. Root gets `{}` |
| `read(key, id?)` | Load data and subscribe this fragment to `key` or `key:id`. `id` reaches the loader as a string |
| `frag(name, params?)` | Render a child fragment that updates on its own. Returns `Html` |

- A fragment's DOM id is `name`, or `name?a=1&b=2` (params sorted).
- A fragment re-renders completely, including its children, when any key it read is written. Its whole HTML is one patch.
- Loads are memoized per render pass by user, key and id.
- Writes in one tick merge into one pass. Only fragments with an open client render. Unchanged HTML is not sent.
- The render pass runs inside the tool call that wrote, so a throw fails that call.

## HTML helpers

| Helper | Meaning |
|---|---|
| `` html`...` `` | Tagged template. Values are escaped; `Html` values and arrays are inlined; `null`, `undefined`, `false`, `true` render nothing; numbers render (including `0`) |
| `raw(s)` | Mark a string as trusted HTML |
| `esc(v)` | Escape to a string |
| `attrs(obj)` | Attributes: `true` → bare, `false`/`null`/`undefined` → omitted, objects → JSON |
| `cx(...classes)` | Join truthy class names |
| `type Html` | `{ __html: string }` |

## Components

All return `Html`. Children are extra arguments (strings, numbers, `Html`, arrays).

**Action props** (on `Button`, `Form`, `Input`, `Textarea`, `Select`, `Checkbox`, menu items): `tool?: string` (must be in `writes`), `args?: Record<string, unknown>` (merged last, keeps JSON types), `close?: boolean` (close the surrounding dialog or menu on success).

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
| `Button(props, ...kids)` | `variant?: "primary" \| "secondary" \| "ghost" \| "danger"`, `size?: "sm" \| "md"`, `icon?`, `label?` (required for icon-only), `opens?` (popover id), `type?: "button" \| "submit"`, `disabled?`, `id?` + action props | `args` |
| `Form(props, ...kids)` | `id?`, `keepValues?` + action props | all named fields as strings, then `args`. Resets on success unless `keepValues` |
| `Input(props)` | `name`, `label?`, `hint?`, `required?`, `placeholder?`, `disabled?`, `type?`, `value?`, `autofocus?`, `debounce?` + action props | with `tool`: `{ [name]: string }` + `args`, on change, or as you type with `debounce` |
| `Textarea(props)` | `name`, `label?`, `hint?`, `required?`, `placeholder?`, `disabled?`, `value?`, `rows?` + action props | same as Input |
| `Select(props)` | `name`, `options: (string \| { value, label })[]`, `value?`, `label?`, `hint?`, `disabled?` + action props | `{ [name]: string }` + `args`, on change |
| `Checkbox(props)` | `name`, `label?`, `checked?`, `switch?`, `disabled?` + action props | `{ [name]: boolean }` + `args`, on change |

A `Button` with no children and an `icon` is icon-only. A `Button` with no `tool` and no `opens` inside a `Form` submits the form.

### Display

| Signature | Props |
|---|---|
| `Badge(props, ...kids)` | `tone?`, `outline?`, `dot?` |
| `Dot(props)` | `tone?`, `pulse?`, `label?` (accessible name) |
| `Stat({ label, value, delta?, tone? })` | `tone` colours `delta` |
| `Table<T>({ id?, rows, columns, rowKey?, empty? })` | Row ids `${id}-${rowKey(row)}`. Empty `rows` with `empty` renders `empty` only |
| `Empty({ title, description?, action?, icon? })` | |
| `Skeleton({ lines?, width? })` | |
| `Kbd(key)`, `Muted(...kids)`, `Mono(...kids)` | |
| `Icon(name)` | `plus check x more chevron down search trash pin external refresh` |

Column: `{ label: string; key?: keyof T; cell?: (row: T) => unknown; align?: "left" | "right"; mono?: boolean; width?: string }`.

Tones: `"neutral" | "ok" | "warn" | "bad" | "info"` (`type Tone`).

### Overlays and tabs

| Signature | Notes |
|---|---|
| `Dialog({ id, title, description? }, ...kids)` | Native popover. Open with `Button({ opens: id })`. Put buttons in `` html`<div class="actions">...</div>` `` |
| `Close(id, label = "Cancel")` | Secondary button that hides the popover |
| `Menu({ id, items })` | Items: `{ label, icon?, kbd?, danger?, href?, tool?, args?, close? }` or `"-"`. Tool items close the menu by default; `href` items open in a new tab |
| `Tabs({ id, tabs: { label, content }[], selected? })` | Up to 6 tabs. Selection stays in the browser across updates |

## Runtime attributes and states

Components set these; use them directly in hand-written HTML.

| Attribute | Meaning |
|---|---|
| `hx-tool="name"` | Call this tool. Default trigger: submit for forms, change for inputs/selects/textareas, click otherwise |
| `hx-vals='{"id":1}'` | Extra args as JSON (use `attrs({ "hx-vals": {...} })`) |
| `hx-trigger="input"` + `p-debounce="300"` | Call while typing |
| `p-close` | Close the surrounding popover after success |
| `p-keep-values` | Don't reset the form after success |
| `p-local` | Inputs inside keep their browser state across updates |
| `p-keep` | Never morph this element (it also never receives updates) |
| `p-flash` | Flash this element as a unit when something inside changes |

Set by the runtime: `aria-busy="true"` while calling (ignores clicks, spinner on buttons), `p-error="message"` after a thrown error (shown in red by the kit), `p-updated` for 900 ms on the nearest changed `tr`, `li`, `.stat` or `[p-flash]`.

The morph matches elements by id, keeps the focused input's value and caret, keeps open popovers and `<details open>`.

## How UI calls reach your handler

- In hosts: the runtime calls the app-only `p_call` tool with `{ tool, args }`. In web mode: `POST <base>/tool/<name>`.
- Projection calls the captured handler as `handler(args, extra)`. **No zod parsing**: no coercion, no defaults, no validation, no output-schema check.
- `extra` in hosts is the `p_call` request's `extra` (same `authInfo` as the host). In web mode it is `{ authInfo: { extra: { sub: user } }, ui: "web" }`.
- Tools registered without `inputSchema` are called by the SDK as `handler(extra)`, but by the UI as `handler(args, extra)`.
- A thrown error becomes `p-error` on the element. A returned `{ isError: true }` is treated as success.
- The response carries the tool's result plus the patches it caused, applied at once.

## What attach registers

| Item | Model-visible |
|---|---|
| Resource `ui://<name>/app.html` (`text/html;profile=mcp-app`) | no |
| `_meta.ui.resourceUri` on `attachTo` tools | no (`_meta`) |
| `p_mount`, `p_sync`, `p_call` (`p_call` only without `readOnly`), all `visibility: ["app"]` | no |
| `web.tool`, if set | **yes** |

Register your own UI-only tools with `_meta: { ui: { visibility: ["app"] } }`.

## Styling

Tokens fall back to MCP Apps host variables, so the UI follows the host theme:

`--p-bg --p-bg-2 --p-bg-3` (background), `--p-fg --p-fg-2 --p-fg-3` (text), `--p-line --p-line-2` (borders), `--p-inv --p-inv-fg` (primary button), `--p-ring` (focus, flash), `--p-ok --p-warn --p-bad --p-info` (tones), `--p-r --p-r-sm` (radius), `--p-font --p-mono`, `--p-shadow`.

Utility classes: `stack row between grid grow muted subtle mono sm xs`; `.actions` inside dialogs; layout reads `--gap` and `--min` from inline styles.

Dark mode: `data-theme="dark"` from the host, or the system setting on the web. `bare: true` also removes `p-f { display: contents }`, the flash, busy and error styles; add your own.

External images, fonts and stylesheets are blocked in web mode (CSP) and projection declares no extra domains to hosts. Use inline SVG and `data:` URIs.

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
| `sessionTtl` | `3600` | Seconds a browser session lasts |
| `tool` | none | Register a **model-visible** tool that opens the UI for the caller (URL elicitation; falls back to returning the link as text) |
| `toolDescription` | generated | Description for that tool |

| `ui.site` member | Meaning |
|---|---|
| `fetch(request)` | `Promise<Response \| null>`; `null` when the path is outside `base` |
| `node(req, res, next?)` | Node adapter; calls `next()` for other paths if given, else 404. Reads the body itself: mount before body parsers, at the app root |
| `link(user, { readOnly? })` | Mint a single-use link. Trusted server code only |
| `revoke(user)` | End all links and sessions for a user |
| `close()` | Stop the expiry sweep |

Flow: GET on a link shows a Continue page; POST redeems it, sets an HttpOnly, SameSite=Lax cookie scoped to `base` (Secure on https) and redirects to `<base>/`. API calls need the `P-Req: 1` header. Strict CSP, `no-referrer`, `no-store`. Tokens are stored hashed.

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
| `t.mount(root?)` | Mount and keep syncing; returns a view |
| `t.close()` | Close both clients |
| `view.html()`, `view.text()` | Current HTML and its visible text |
| `view.click(tool, args)` | Call like an `hx-tool` click; returns the tool result; throws on a thrown error. Doesn't check a matching element exists |
| `view.until((text, html) => boolean, ms = 2000)` | Wait for the UI to match |
| `view.close()` | Stop syncing |
| `view.pid` | Client id |

End the script with `process.exit()`: a pending server-side long-poll can hold Node open for 25 s.

## Preview CLI

```bash
npx mcp-projection preview dist/ui.js [fragment] [--dark|--light] [--user=id] > preview.html
```

The module must export `ui` (or default-export it). It renders whatever the loaders return in a fresh process; seed data with a script calling `ui.preview()` instead (assets/preview.mjs).

## Dev warnings and errors

| Message | Fix |
|---|---|
| `Fragment "x" uses hx-tool="t", but "t" is not in defineUi({ writes }).` | Add `t: [keys]` to `writes` |
| `Tool "t" was never registered after ui.attach().` / `writes lists "t" but no tool "t" was registered after ui.attach().` | Attach before registering; convert `server.tool()`; check the name |
| `Fragment "x" uses hx-tool="t" but the UI is readOnly` | Remove the action or `readOnly` |
| `No loader for "k". Add it to defineUi({ load: ... }). Known: ...` | Add the loader or fix the key |
| `Unknown fragment "x". Defined: ...` | Define it or fix the name |
| `UI may not call "t". Add it to defineUi({ writes }).` | Add to `writes` |
| `Tool "t" is in writes but was not registered after ui.attach().` | As above |
| `ui.attach() was already called for this server.` | Attach once per server instance |
| `Tool p_mount is already registered` | Two `ui`s on one server; use one |
| `openInBrowser needs defineUi({ web: { origin } }).` | Configure `web` |
