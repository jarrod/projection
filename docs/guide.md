# Writing UIs for MCP servers

A guide to adding a human interface to an MCP server with `mcp-projection`: how it works, how to decide what the UI should show, how to build and test it, and what to avoid. It is written for developers and for coding agents doing the work for them.

If you only need the API, read [AGENTS.md](../AGENTS.md). If you want an agent to do the integration, give it the skill in [`skills/mcp-projection`](../skills/mcp-projection/SKILL.md). This guide describes version 0.3.

**Contents**

1. [How it works](#1-how-it-works)
2. [Before you start](#2-before-you-start)
3. [Integrate in five steps](#3-integrate-in-five-steps)
4. [Design the UI](#4-design-the-ui)
5. [The view and its params](#5-the-view-and-its-params)
6. [Writing HTML](#6-writing-html)
7. [Components](#7-components)
8. [Actions: how the UI changes things](#8-actions-how-the-ui-changes-things)
9. [State in the browser, without JavaScript](#9-state-in-the-browser-without-javascript)
10. [Live updates](#10-live-updates)
11. [Users and identity](#11-users-and-identity)
12. [Styling and theming](#12-styling-and-theming)
13. [Web mode](#13-web-mode)
14. [Testing and checking](#14-testing-and-checking)
15. [Performance and size](#15-performance-and-size)
16. [Security](#16-security)
17. [Pitfalls](#17-pitfalls)
18. [Worked example: a tasks server](#18-worked-example-a-tasks-server)
19. [Checklist](#19-checklist)

---

## 1. How it works

An MCP server has two audiences. The model calls its tools. The people working with that model want to see what is going on and sometimes act directly. Projection serves the second audience from the same server and the same tools, without changing anything the model sees.

Three ideas carry the whole design:

- **UI = view(user, params).** The view is one server function. It reads your data and returns HTML. Nothing renders in the browser.
- **Actions are your existing tools.** A button with `tool: "pin_note"` runs the same handler the agent runs, through the server's own `tools/call` handler.
- **Live updates come from tool calls.** After any tool call, from the agent or a human, the view runs again for every open screen. For changes that happen outside a tool, call `ui.write()`.

### Where the UI appears

| Surface | How it is reached | Transport |
|---|---|---|
| MCP Apps hosts (Claude, ChatGPT, VS Code and others that support the extension) | The agent calls a tool listed in `attachTo`. The host sees `_meta.ui.resourceUri` on that tool, fetches the `ui://` resource and shows it in a sandboxed frame. | MCP: the frame calls tools through the host |
| A normal URL (optional, "web mode") | A single-use link minted by the server, usually sent through MCP URL elicitation so it never enters the model's context | HTTP: POST for actions and for the sync poll |

### What `ui.attach(server)` adds

| Added | Visible to the model? | Purpose |
|---|---|---|
| Resource `ui://<name>/app.html` | No | The shell: tokens, kit CSS and the browser runtime |
| `_meta.ui.resourceUri` on each `attachTo` tool | No (`_meta` is for hosts) | Tells the host to open the UI when that tool runs |
| Tool `p_sync` | No (`visibility: ["app"]`) | Renders the view, or waits up to 25 s for a change |
| Tool named by `web.tool` | **Yes**, and only if you ask for it | Sends the human a link to the web UI |

It also wraps `server.registerTool` and the server's request handlers so it can see every `tools/call`. Your configs and your handlers' results pass through unchanged. The only addition is `_meta` on `attachTo` tools.

### One update, step by step

The agent calls `add_note`:

1. The wrapped `tools/call` handler runs your handler and keeps its result.
2. It calls `write()`, which bumps a change counter and returns. The agent's call finishes without waiting for any UI work.
3. Every open screen has a `p_sync` call waiting with the counter it last saw. They all wake.
4. Each viewer sends its view params. Viewers with the same user and params share one render of the view.
5. The server compares the HTML's hash with the one the viewer sent. If it is the same, it answers with no HTML. Otherwise it sends the whole new HTML.
6. The runtime morphs the page in place, matching elements by id, and briefly highlights rows that changed.

A human click starts from the other side. The runtime calls your tool, your handler runs, and `write()` fires the same way. The person who clicked sees the result when the next sync returns, which is right away because the counter moved.

The server keeps no per-viewer state. `p_sync` is a pure function of the user, the view params and one change counter.

---

## 2. Before you start

Projection fits when all of these hold:

- **Node 20 or later**, TypeScript or JavaScript, ES modules.
- The server uses **`McpServer` from `@modelcontextprotocol/sdk`** (1.20 or later) with **zod** (3.25 or later).

Check these before writing any UI code:

**`server.tool()` and `server.registerTool()` both work.** `attach` wraps the server's `tools/call` handler, so it does not matter how tools are registered. What matters is order: call `ui.attach` before you register any tool.

**A low-level `Server` doesn't fit.** `ui.attach` needs `registerTool` and `registerResource`. Move to `McpServer` first, or don't use projection.

**Python, Go and other runtimes are not supported.** Projection is a TypeScript library that runs inside the server process.

Also worth knowing:

- Put server construction in a factory (`export function createServer()`) that registers tools and returns the server, and keep `server.connect(transport)` in the entry file. The test harness needs the factory.
- Create **one** `ui` with `defineUi` at module level and call `ui.attach` on **each** server instance. Per-session servers are fine. Calling `attach` twice on the same server throws, and two `ui`s can't share a server (both would register `p_sync`).
- State lives in memory in one process. With several instances, a change on one reaches viewers on another only when their poll times out (up to 25 s). Web mode keeps links and sessions in memory, so it needs one instance or sticky routing, and a restart ends every browser session.
- Projection has not yet been run inside a real host. Unverified there: that `visibility: ["app"]` is honoured, and that a held `p_sync` call (up to 25 s) is tolerated.

---

## 3. Integrate in five steps

### Step 1: Install

```bash
npm install github:jarrod/projection
```

npm builds the package while it fetches it from git. npm 11 may print an `allowScripts` warning about `mcp-projection`'s `prepare` script. If `node_modules/mcp-projection/dist/index.js` exists, ignore the warning. If it doesn't (for example, npm is configured with `ignore-scripts`), build a tarball yourself and install that:

```bash
git clone --depth 1 https://github.com/jarrod/projection && cd projection && npm install && npm run build && npm pack
```

```bash
npm install ./projection/mcp-projection-0.3.0.tgz
```

`@modelcontextprotocol/sdk` and `zod` are peer dependencies. Your server already has them.

### Step 2: Snapshot what the model sees

Before changing anything, record the model-visible tools so you can prove later that they didn't change:

```bash
node node_modules/mcp-projection/skills/mcp-projection/scripts/tool-snapshot.mjs --out .projection-before.json -- node dist/index.js
```

Run it from your server's project folder (it finds the SDK there), with the command that starts your server after `--`. Section 14.4 covers the options.

### Step 3: Write `src/ui.ts`

Keep the UI in this one file (split it when it grows past a few hundred lines).

```ts
import { defineUi, html, Header, Button, Table } from "mcp-projection";
import { store } from "./store.js";

export const ui = defineUi({
  name: "notes",
  attachTo: ["list_notes"],               // tools whose results open the UI in hosts
  view: ({ user, params }) => html`
    ${Header({ title: "Notes" })}
    ${Table({
      id: "notes", rows: store.list(user), rowKey: (n) => n.id,
      columns: [
        { label: "Title", key: "title" },
        { label: "", cell: (n) => Button({ size: "sm", tool: "pin_note", args: { id: n.id } }, "Pin") },
      ],
    })}`,
});
```

The view reads your store directly. It does not call your tools, because tools return text for a model and the view needs objects.

### Step 4: Attach it, before registering tools

```ts
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
server.registerTool("add_note", /* exactly as before */);
```

This is the only change to existing code. Tools registered before `attach` make it throw.

### Step 5: Verify

1. Build and run a `testUi` test (section 14): the UI mounts, an agent call updates it, a click works.
2. Render a preview and look at it in light and dark.
3. Compare the tool snapshot: run the same command with `--compare .projection-before.json` instead of `--out`. It must report OK.

---

## 4. Design the UI

The tool list tells you what the system *can* do. It doesn't tell you what a person needs to *see*. Design from the person.

### 4.1 Start from the person and the moment

Answer these before choosing components:

1. **Who opens this, and when?** In a host, the UI appears when the agent calls an `attachTo` tool, inside the conversation. On the web, it's a page someone keeps open beside their work. The first is a glance; the second is a workspace.
2. **What should they understand in five seconds?** Usually: what exists, what state it's in, what changed, and whether anything needs them.
3. **What is faster by hand than by asking the agent?** Toggling, approving, fixing a typo, deleting one thing. These become actions.
4. **What must a human decide?** Approvals, destructive changes and anything the agent shouldn't do alone. Make these explicit, with a confirm step.
5. **What would they otherwise ask the agent to re-list?** That's the main view.

### 4.2 Map the server onto the UI

| The server has | The UI gets |
|---|---|
| Read tools (`list_*`, `get_*`, `search_*`) | Reads of the same store inside `view` |
| Write tools (`add_*`, `set_*`, `delete_*`) | Nothing needed for liveness. A control only for what a human should do by hand |
| The tool after which a person wants to look | `attachTo` (usually one) |
| Data changed outside tools (cron, webhooks) | `ui.write()` where the change happens |
| UI state: search, filter, page, selection | View params, changed with `set` |
| Tools that change nothing | `annotations: { readOnlyHint: true }`, so their calls don't refresh viewers |

Never add a model-visible tool or change an agent tool for the UI's sake. Any tool a human can click is a tool the agent can call, and the other way round. If a tool must never be run by a human, put no control for it in the view.

### 4.3 Layout patterns

Pick one or two per screen. Code for each is in [`skills/mcp-projection/references/recipes.md`](../skills/mcp-projection/references/recipes.md).

| Pattern | Use it for | Built from |
|---|---|---|
| Overview | Counts and health | `Grid({ min: 140 })` of `Stat` |
| Collection | The main list the agent manages | `Card({ flush: true })` around `Table`; status as `Badge`; small icon-only row buttons |
| Queue | Items waiting for a human | A filtered table with Reject and Approve per row |
| Activity feed | What the agent just did | `<ul>` of `<li id>` with `Mono` timestamps, newest first, capped |
| Run monitor | Long jobs | Table with `Badge` state and `Dot({ pulse: true })`; a worker calls `ui.write()` |
| Detail | One item's full content | Per-row `Dialog`, or an `open` param that swaps list for detail |
| Settings | A few values the agent reads | `Checkbox({ switch: true, tool })` and `Select({ tool })` in a `Grid` |

Screen order: header, what needs the person, status, the full collection, history and settings.

### 4.4 Visual rules

- Colour means state. Tones only for status, never decoration.
- One primary button per view. Others are `secondary` or `ghost`; destructive confirms are `danger`.
- Small controls in tables: `size: "sm"`, `variant: "ghost"`, icon-only with a `label`.
- Numbers and ids in `Mono`.
- Empty states say how to fill them: "No tasks yet. Ask your assistant to add one."
- Confirm destructive actions with a dialog that names the item.
- Work at 420 px. Hosts often show the UI in a narrow column. Keep at most four or five table columns.
- Icon-only buttons and dots need `label`. Use real controls, not clickable `div`s. Don't carry state by colour alone.

---

## 5. The view and its params

There is one `view`. It receives `{ user, params }` and returns the whole UI as `html`.

```ts
view: async ({ user, params }) => html`...`
```

- **It runs again** after every tool call (except `p_sync` and `readOnlyHint` tools) and after `ui.write()`. Reading the store inside it keeps it current.
- **`user`** is the MCP user: `authInfo.extra.sub`, or `"local"` with no auth. Filter per-user data by it.
- **`params`** is per-viewer state: search text, filter, page, open item. It lives in the browser, goes up with each sync, and resets when the UI is reopened. It starts as `{}`.
- **Params are untrusted.** Any value can be any JSON type. Read them defensively: `String(params.q ?? "")`, clamp numbers, check against an allowed list.
- **The view must return `html`.** Anything else throws `view must return html`...``.
- **Make it unable to throw.** A throwing view fails only that viewer's sync, not agent calls, but the person sees nothing. Wrap data reads you don't control in `try`/`catch` and render a message.
- Split a big view into plain functions that return `html`. They are not registered anywhere.

Typical shape:

```
view
├── Header, ThemeToggle?       layout
├── Stats(items)               Stat grid
├── List(items, params)        filtered by params, one table
├── Activity(events)           recent history
└── Dialogs                    create, confirm delete (outside the table is fine; inside a cell works too)
```

---

## 6. Writing HTML

`html` is a tagged template. It escapes every interpolated value.

```ts
import { html, raw } from "mcp-projection";

html`<li>${note.title}</li>`                     // title is escaped
html`<ul>${notes.map((n) => html`<li>${n.title}</li>`)}</ul>`   // arrays of html are inlined
html`${count > 0 && html`<b>${count}</b>`}`      // false renders nothing; 0 renders "0"
```

Rules:

- Numbers render, including `0`. `null`, `undefined`, `true` and `false` render nothing. That is why `${n && html`...`}` prints `0` when `n` is `0`. Use `${n > 0 && ...}`.
- A string of HTML is escaped on purpose. Build markup with `html`. Use `raw(s)` only for HTML you produced and trust.
- Check URL schemes before rendering user-supplied links.
- Other helpers: `esc(v)` escapes to a string, `attrs(obj)` renders attributes, `cx(...)` joins class names.
- `<script>` in the output does not run. There is no client JavaScript besides the runtime.

Give every repeating element a stable, page-unique `id` (`<li id="ev-${e.id}">`). The morph matches by id, so new rows slide in and old ones stay put. Without ids, a whole list re-morphs and flashes.

---

## 7. Components

All components return `html` and take children as extra arguments. The full list, props and icon names are in [AGENTS.md](../AGENTS.md) and [`references/api.md`](../skills/mcp-projection/references/api.md). In short:

- **Layout:** `Stack`, `Row`, `Grid`, `Separator`, `Header`, `Card`.
- **Controls:** `Button`, `Form`, `Input`, `Textarea`, `Select`, `Checkbox`.
- **Display:** `Badge`, `Dot`, `Kbd`, `Muted`, `Mono`, `Stat`, `Table`, `Empty`, `Skeleton`, `Icon`.
- **Overlays and tabs:** `Tabs`, `Dialog`, `Close`, `Menu`, `ThemeToggle`.

Notes that save time:

- A `Table` needs `rowKey` and an `id` so rows keep their identity. Two tables on one page need different `id`s.
- `Table` `align: "right"` aligns text. To right-align buttons, wrap them in `` html`<div class="row" style="justify-content:flex-end">...</div>` ``.
- Pass `actions: cond ? x : undefined`, not `cond && x`.
- A `Dialog` opens with `Button({ opens: id })`. Put its buttons in `` html`<div class="actions">...</div>` ``.
- `Tabs` takes up to six tabs and keeps the selected tab in the browser.
- Components may be used anywhere in the view, including inside table cells.

---

## 8. Actions: how the UI changes things

### 8.1 The action props

Controls take these props:

| Prop | Meaning |
|---|---|
| `tool` | Call this tool |
| `args` | Extra arguments, merged last. They keep JSON types |
| `set` | Instead of a tool: merge values into the view params and render again. `true` on an `Input`, `Select` or `Form` sets its own fields |
| `close` | Close the surrounding dialog or menu on success |

The default trigger is `submit` for forms, `change` for inputs, selects and checkboxes, and `click` for buttons. `Input` with `debounce` acts while typing.

### 8.2 What the handler receives

The call goes through the server's own `tools/call` handler. That means:

- **Validation runs.** zod checks the input, applies defaults and coerces where you asked it to. The UI has no way around your schema.
- **Form values are text.** A text field arrives as a string, a checkbox as a boolean. For a number, use `z.coerce.number()` in the schema, or pass it in `args`, where it keeps its JSON type.
- **Failures show on the control.** A thrown error, a zod rejection or a result with `isError: true` shows as `p-error` with the message, and the control goes back to what the server last rendered. You don't need a second tool to report failures.
- **Output schemas are checked** like any other call.

```ts
Select({ name: "status", value: t.status, options: ["todo", "doing", "done"], tool: "set_status", args: { id: t.id } })
// handler gets { id: 7, status: "doing" }: id from args (a number), status from the select (a string)
```

### 8.3 View state needs no tools

Search text, filters, pages and the open item are view params. A `set` control changes them, and nothing is called on the server:

```ts
Input({ name: "q", set: true, debounce: 250, value: String(params.q ?? "") })
Button({ set: { page: 2 } }, "Next")
Button({ set: { open: t.id } }, "Details")
Button({ set: { open: null } }, "Back")
```

Old designs used app-only `ui_*` tools to hold this state on the server. That is gone. Params live in the browser, so the server keeps nothing per viewer.

### 8.4 Confirm destructive actions

Open a dialog from a button, and put the real action behind a form inside it:

```ts
Button({ variant: "ghost", size: "sm", icon: "trash", label: "Delete", opens: `del-${t.id}` }),
Dialog({ id: `del-${t.id}`, title: "Delete task?" },
  Form({ tool: "delete_task", args: { id: t.id }, close: true },
    html`<div class="actions">${Close(`del-${t.id}`)}${Button({ type: "submit", variant: "danger" }, "Delete")}</div>`))
```

### 8.5 Forms

A `Form` sends all its named fields, then `args`. It resets on success unless `keepValues` is set, and `close: true` closes the dialog it sits in.

---

## 9. State in the browser, without JavaScript

The runtime keeps what a person did between updates:

- Text typed, boxes ticked and options selected survive updates unless the server changes that field's value.
- Open popovers (`Dialog`, `Menu`) and `<details open>` stay open. Give them an `id`.
- `Tabs` keeps the selected tab.
- Mark an element `p-keep` to stop the morph touching it at all. It then never receives updates.
- For state that should change what the view renders, use a param and `set`.

---

## 10. Live updates

- **Every tool call** except `p_sync` and `readOnlyHint` tools refreshes viewers, from the agent or a human.
- **Outside tools**, call `ui.write()` where the change happens: a cron job, a webhook, a worker. A burst of writes wakes viewers once.
- **Transport:** the runtime long-polls `p_sync` with its params, the hash of what it shows and the counter it last saw. The server holds the call up to 25 s, then answers with a counter and, if the HTML differs, the new HTML. The web runtime uses `POST /sync` the same way. There is no SSE.
- **Cost:** viewers with the same user and params share one render. The whole view is sent when it changes.
- **Morph:** elements are matched by id. Changed rows get `p-updated` for 900 ms, which the kit shows as a highlight. `p-flash` on an element flashes it as a unit.
- With several instances, a change on one reaches viewers on another when their poll times out. The runtime paces itself to about one poll a second if the server answers at once with nothing new.

---

## 11. Users and identity

The view gets a stable `user`. Projection has no sign-in of its own, so identity always comes from MCP `authInfo`.

- Default: `authInfo.extra.sub`, or `"local"` when the request carries no auth. Without auth, every viewer is the same user.
- An authenticated request with no `extra.sub` throws `No user id: set authInfo.extra.sub in your token verifier, or return one from defineUi({ identify }).` A client id names the agent app, not the person.
- Override with `defineUi({ identify: (extra) => ... })`. Returning nothing throws.
- In a tool handler, call `ui.identify(extra)` so the tool and the view agree on who is asking.

```ts
server.registerTool("add_note", { inputSchema: { title: z.string() } }, async ({ title }, extra) => {
  store.add(ui.identify(extra), title);
  return text("added");
});
```

In web mode, a tool call from the browser carries the `authInfo` of the MCP request that minted the link. It cannot send notifications or requests, so a handler that needs `sendNotification` or a client id will not work there.

---

## 12. Styling and theming

Two cascade layers ship with the UI: `tokens.css` (design tokens) and `kit.css` (components, built on the tokens). Your `css` option is unlayered, so it wins.

```ts
import { defineUi, themes } from "mcp-projection";
defineUi({ name: "x", view, css: ":root { --p-r: 6px }" });
defineUi({ name: "x", view, css: themes.terminal });          // or themes.pop
defineUi({ name: "x", view, css: themes.terminal + ":root { --p-ok: #7bd88f }" });
```

Tokens: `--p-bg --p-bg-2 --p-bg-3`, `--p-fg --p-fg-2 --p-fg-3`, `--p-line --p-line-2`, `--p-inv --p-inv-fg`, `--p-ring`, `--p-ok --p-warn --p-bad --p-info`, `--p-r --p-r-sm`, `--p-font --p-mono`, `--p-shadow`, `--p-ease`, `--p-edge`.

- Use tokens for colour and the UI follows light and dark. The host's `data-theme` wins, then `ThemeToggle()`, then the OS.
- Utility classes: `stack row between grid grow muted subtle mono sm xs`, and `.actions` in dialogs. Layout reads `--gap` and `--min` from inline styles.
- `bare: true` drops tokens and the kit. `css: TOKENS + myKit` keeps the tokens (both are exported) and replaces the components. Then you own `p-f { display: contents }` and the rules for `[p-updated]`, `[aria-busy]` and `[p-error]`.
- `css` must not contain `</style`.
- External images, fonts and stylesheets are blocked in web mode and projection declares no extra domains to hosts. Use inline SVG, `data:` URIs and `Icon`.

---

## 13. Web mode

Web mode serves the same view on a normal URL. There is no sign-in. A browser session is delegated from an MCP request through a single-use link, and acts as that MCP user.

```ts
export const ui = defineUi({
  name: "notes", view,
  web: { origin: "https://app.example.com", tool: "open_notes_in_browser" },
});
```

Serve it with the Node adapter or a fetch handler:

```ts
import http from "node:http";
http.createServer((req, res) => ui.site!.node(req, res)).listen(3000);

// Express: mount at the app root, before body parsers
app.use((req, res, next) => ui.site!.node(req, res, next));

// Fetch-style runtimes
const r = await ui.site!.fetch(request);   // null when the path is outside the mount
```

Options: `origin` (required), `base` (default `/ui`), `linkTtl` (120 s), `sessionTtl` (3600 s, never longer than the MCP auth), `tool` and `toolDescription`.

How a person gets in:

- With `web.tool` set, the model gets one extra tool. It uses URL elicitation to ask the host to open the link, or returns the link as text if the host can't.
- From any of your own tool handlers: `ui.openInBrowser(extra, { server })`, or `ui.link(extra, server)` for the URL alone. `server` is the attached `McpServer` handling the request.
- The link works once. A GET shows a Continue page, so link unfurlers can't burn it. A POST from that page redeems it and sets an HttpOnly, SameSite=Lax cookie.
- `ui.site.revoke(user)` ends all links and sessions for a user. `ui.site.close()` stops the expiry sweep.

Limits and behaviour:

- Browser requests need the `P-Req: 1` header. One session holds up to 8 open views.
- `ui.link` and `ui.openInBrowser` throw `Not available from the web UI.` when called from a web session.
- Strict CSP, `no-referrer` and `no-store` on every response. Tokens are stored hashed. The Node adapter compresses with brotli or gzip, answers 413 over 1 MB and 500 on error.
- Links and sessions are in memory. Run one instance, or use sticky routing.

---

## 14. Testing and checking

### 14.1 `testUi`

```js
import { testUi } from "mcp-projection/testing";
import { createServer } from "./dist/server.js";

const t = await testUi(createServer);   // calls the factory twice: an agent client and a host client
const view = await t.mount();           // or t.mount({ q: "x" }) with starting params
await t.agent.callTool({ name: "add_note", arguments: { title: "Hello" } });
await view.until((text) => text.includes("Hello"));
await view.click("pin_note", { id: 1 });
await view.set({ q: "hello" });         // like a set control
view.close(); await t.close(); process.exit();
```

| Member | Meaning |
|---|---|
| `t.agent`, `t.host` | MCP clients |
| `t.tools`, `t.modelTools` | All tools, and the ones the model sees |
| `t.resourceUri` | First `_meta.ui.resourceUri` found |
| `view.html()`, `view.text()` | Current HTML and its visible text |
| `view.click(tool, args)` | Call a tool like a click would. Throws if the tool returns an error |
| `view.set(params)` | Merge view params, then render again |
| `view.until((text, html) => boolean, ms = 2000)` | Wait for the UI to match |

Two things to know:

- `click` doesn't check that a matching control exists. Assert `view.html().includes('hx-tool="pin_note"')` when it matters.
- Finish with `process.exit()`. A pending long-poll on the server can keep Node alive for up to 25 seconds after `t.close()`.

### 14.2 Snapshot the HTML

```js
const html = await ui.render({ q: "x" }, "u1");   // params, then user; includes the <p-f id="p-root"> wrapper
```

### 14.3 Look at it

Tests prove behaviour; they don't prove it looks right. Render a static, styled page and look at it:

```bash
npx mcp-projection preview dist/ui.js > preview.html
npx mcp-projection preview dist/ui.js '{"q":"x"}' --dark > preview-dark.html
```

Arguments: the compiled module (it must export `ui`), optional view params as JSON, `--dark` or `--light`, `--user=<id>`. The page has the CSS and no runtime.

The CLI renders in a fresh process, often with an empty store. To see real content, write a short script that seeds the store and calls `ui.preview()`:

```js
import { writeFileSync } from "node:fs";
import { ui } from "./dist/ui.js";
import { store } from "./dist/store.js";
store.add("Ship the UI layer", "agent");
store.add("Write the guide", "jarrod");
for (const theme of ["light", "dark"]) writeFileSync(`preview-${theme}.html`, await ui.preview({}, { theme }));
process.exit(0);
```

Take a screenshot with headless Chrome (on macOS the binary is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`):

```bash
google-chrome --headless=new --screenshot=preview.png --window-size=1040,900 "file://$PWD/preview-light.html"
```

Check light and dark, a narrow width (about 420 px), empty states and long text. Headless Chrome won't lay out narrower than 500 px: a smaller `--window-size` just crops. For a true narrow layout, load the preview in an iframe of that width:

```bash
echo '<body style="margin:0"><iframe src="preview-light.html" style="width:420px;height:900px;border:0"></iframe>' > narrow.html
google-chrome --headless=new --screenshot=narrow.png --window-size=520,900 "file://$PWD/narrow.html"
```

### 14.4 Prove the agent surface didn't change

`tool-snapshot.mjs` (in `skills/mcp-projection/scripts/`, also at `node_modules/mcp-projection/skills/mcp-projection/scripts/`) connects to your server as a plain MCP client and records every model-visible tool (everything except `_meta`) and, optionally, the results of some calls.

```bash
node tool-snapshot.mjs --out before.json -- node dist/index.js            # before the UI
node tool-snapshot.mjs --compare before.json -- node dist/index.js        # after
node tool-snapshot.mjs --url http://localhost:3000/mcp --compare before.json
```

`--calls calls.json` (a JSON array of `[toolName, args]`) also records results. Only list calls that are safe against the server's data. With `--compare`, a changed or missing tool, or a different call result, fails with exit code 1. New model-visible tools are listed but allowed, since `web.tool` adds one on purpose; `--strict` makes them fail too.

---

## 15. Performance and size

- The shell (CSS plus runtime) is small: the MCP runtime is under 2.5 KB gzipped and the kit CSS under 4 KB. Your `css` adds to it.
- The whole view re-renders for each distinct (user, params) pair after a change, and the whole HTML is sent when it differs. The morph keeps DOM changes small, but the bytes are the view's size. A 500-row table resends 500 rows when one changes.
- For big collections, show the most recent or most relevant N rows (about 200 at most) and add a page or limit param.
- Keep the view fast. It runs once per distinct viewer after every change. A slow data read slows every viewer, not the agent.
- Unchanged HTML isn't sent, and viewers with the same user and params share one render.

---

## 16. Security

- `html` escapes everything. `raw()` is only for HTML you produced.
- Check URL schemes before rendering user-supplied links.
- The UI calls tools through your handler. Validation, defaults and output checks run. Any tool a control calls can also be called by anyone who can open the UI, with any arguments your schema accepts. Validate in the handler where it matters.
- Params are untrusted. Read them defensively.
- Put controls only on tools a human should run.
- Without authentication, every viewer is the same user.
- Web mode inherits your MCP server's notion of identity. It adds no authentication of its own.

---

## 17. Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `ui.attach(server) must be called before any tool is registered` | A tool was registered before `attach` | Attach first |
| Agent calls don't refresh the UI | The tool is `readOnlyHint`, or the data changed outside a tool | Drop the annotation, or call `ui.write()` |
| A number arrives as a string | Form fields send text | `z.coerce.number()`, or pass it in `args` |
| The action failed and the control turned red | The handler threw, returned `isError`, or zod rejected the input | Read the message; fix the args |
| A viewer sees an error or an old screen | The view threw | Make the view total (section 5) |
| Params are missing or odd | Params are untrusted and reset on reopen | `String(params.q ?? "")`; keep durable state in your store |
| Whole list flashes on every change | No ids on rows | `Table({ id, rowKey })`, ids on `li` |
| Rows in a second table don't update | Duplicate ids across two tables | Different table `id`s |
| `0` appears on the page | `` ${n && html`...`} `` with `n === 0` | `` ${n > 0 && html`...`} `` |
| Raw tags show as text | A string of HTML was interpolated | Build with `html`, or `raw()` if trusted |
| A `<script>` does nothing | By design | Use components, `<details>` or params |
| Images or fonts missing on the web | CSP blocks external resources | Inline SVG, `data:` URIs |
| Every viewer shares search text | Not true: params are per browser. Data is shared when there is no auth, since everyone is `"local"` | Add auth, or accept it for single-user servers |
| Tool works from the agent but not from the web UI | It reads `extra` fields web mode doesn't provide | Read `authInfo.extra.sub` via `ui.identify(extra)`, or don't offer it on the web |
| Express web routes 404 or get an empty body | Mounted under a path, or after a body parser | Mount at the root, before body parsers |
| Test process hangs after finishing | Pending long-poll timer | `process.exit()` |

---

## 18. Worked example: a tasks server

An agent-first task tracker with tools `list_tasks`, `add_task`, `set_status` and `delete_task`. The UI shows counts, a searchable list where a person can change status or delete (with confirmation), and an activity feed of what happened. This example compiles under `tsc --strict` and its test passes against the current library.

**Plan**

- Person and moment: a teammate checking on the agent's work; the UI opens when the agent lists tasks.
- View params: `q` (search).
- Actions: change status (select), delete (confirm dialog), new task (dialog form), search (`set`).
- `attachTo: ["list_tasks"]`.

**`src/store.ts`**

```ts
export type Status = "todo" | "doing" | "done";
export type Task = { id: number; title: string; status: Status; owner: string };
export type Event = { id: number; at: number; text: string };

let tasks: Task[] = [], events: Event[] = [], nextTask = 1, nextEvent = 1;

export const store = {
  list: () => tasks,
  events: () => events.slice(-20).reverse(),
  log(text: string) { events.push({ id: nextEvent++, at: Date.now(), text }); },
  add(title: string, owner: string) {
    const t: Task = { id: nextTask++, title, status: "todo", owner };
    tasks.push(t); this.log(`${owner} added "${title}"`); return t;
  },
  setStatus(id: number, status: Status) {
    const t = tasks.find((t) => t.id === id);
    if (!t) throw new Error(`No task ${id}`);
    t.status = status; this.log(`Task ${id} is now ${status}`); return t;
  },
  remove(id: number) {
    const t = tasks.find((t) => t.id === id);
    if (!t) throw new Error(`No task ${id}`);
    tasks = tasks.filter((x) => x !== t); this.log(`Task ${id} was deleted`);
  },
};
```

**`src/ui.ts`**

```ts
import { defineUi, html, Header, Button, Stat, Grid, Table, Dialog, Form, Input, Select, Close, Empty, Card, Stack, Muted, Mono, Dot } from "mcp-projection";
import { store, type Task } from "./store.js";

export const ui = defineUi({
  name: "tasks",
  attachTo: ["list_tasks"],
  view: ({ params }) => {
    const q = String(params.q ?? "");
    const all = store.list();
    const tasks = q ? all.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())) : all;
    const count = (s: string) => all.filter((t) => t.status === s).length;
    return html`
      <div class="stack" style="--gap:20px;max-width:960px;margin:0 auto">
        ${Header({
          title: "Tasks",
          description: html`<span class="row" style="--gap:6px">${Dot({ tone: "ok", pulse: true, label: "Live" })} Shared with your assistant</span>`,
          actions: Button({ opens: "new-task", icon: "plus" }, "New task"),
        })}
        ${Grid({ min: 140 },
          Stat({ label: "To do", value: count("todo") }),
          Stat({ label: "Doing", value: count("doing"), tone: "info" }),
          Stat({ label: "Done", value: count("done"), tone: "ok" }))}
        ${Card({ title: "All tasks", flush: true, actions: Input({ name: "q", set: true, debounce: 250, placeholder: "Search", value: q }) },
          List(tasks, q))}
        ${Card({ title: "Activity" }, Activity())}
        ${Dialog({ id: "new-task", title: "New task", description: "Your assistant sees it straight away." },
          Form({ tool: "add_task", args: { owner: "you" }, close: true },
            Input({ name: "title", label: "Title", required: true }),
            html`<div class="actions">${Close("new-task")}${Button({ type: "submit" }, "Create")}</div>`))}
      </div>`;
  },
});

const List = (rows: Task[], q: string) => Table<Task>({
  id: "tasks", rows, rowKey: (t) => t.id,
  empty: html`<div style="padding:16px">${Empty({ title: q ? `Nothing matches "${q}"` : "No tasks yet", description: "Ask your assistant to add one." })}</div>`,
  columns: [
    { label: "#", cell: (t) => t.id, mono: true, width: "48px" },
    { label: "Task", cell: (t) => Stack({ gap: 2 }, html`<strong style="font-weight:500">${t.title}</strong>`, Muted(t.owner)) },
    { label: "Status", width: "140px", cell: (t) =>
      Select({ name: "status", value: t.status, options: ["todo", "doing", "done"], tool: "set_status", args: { id: t.id } }) },
    { label: "", align: "right", width: "56px", cell: (t) => html`
      ${Button({ variant: "ghost", size: "sm", icon: "trash", label: `Delete task ${t.id}`, opens: `del-${t.id}` })}
      ${Dialog({ id: `del-${t.id}`, title: "Delete task?", description: html`"${t.title}" will be removed for you and your assistant.` },
        Form({ tool: "delete_task", args: { id: t.id }, close: true },
          html`<div class="actions">${Close(`del-${t.id}`)}${Button({ type: "submit", variant: "danger" }, "Delete")}</div>`))}` },
  ],
});

const Activity = () => {
  const events = store.events();
  if (events.length === 0) return Muted("Nothing yet.");
  return html`<ul class="stack" style="--gap:6px;list-style:none;margin:0;padding:0">${events.map((e) =>
    html`<li id="ev-${e.id}" class="row sm">${Mono(new Date(e.at).toISOString().slice(11, 19))} ${e.text}</li>`)}</ul>`;
};
```

**`src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { store } from "./store.js";
import { ui } from "./ui.js";

export function createServer() {
  const server = ui.attach(new McpServer({ name: "tasks", version: "1.0.0" }));
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

  server.registerTool("list_tasks", {
    description: "List all tasks",
    annotations: { readOnlyHint: true },
  }, async () => text(JSON.stringify(store.list())));

  server.registerTool("add_task", {
    description: "Add a task",
    inputSchema: { title: z.string().min(1), owner: z.string().default("agent") },
  }, async ({ title, owner }) => text(JSON.stringify(store.add(title, owner))));

  server.registerTool("set_status", {
    description: "Set a task's status",
    inputSchema: { id: z.number(), status: z.enum(["todo", "doing", "done"]) },
  }, async ({ id, status }) => text(JSON.stringify(store.setStatus(id, status))));

  server.registerTool("delete_task", {
    description: "Delete a task",
    inputSchema: { id: z.number() },
  }, async ({ id }) => { store.remove(id); return text("deleted"); });

  return server;
}
```

Notes on the choices:

- `list_tasks` is `readOnlyHint`, so opening or refreshing the list doesn't wake every viewer.
- `set_status` gets `id` from `args` (a number) and `status` from the select (a string limited by the select's options). The schema's `z.number()` would reject a string id, so the id must travel in `args`.
- The new-task form sends `owner` through `args`. The schema's default would also work, because validation runs, but `"you"` says who made the task.
- Activity rows use an incrementing event id, so new rows slide in and flash while old ones stay put.
- Search is a param (`q`) set by the input. There is no server-side search state and no extra tool.
- A failure, for example deleting a task that is already gone, throws in the handler and shows as `p-error` on the form.

**Something changes outside a tool**: a nightly sync finishes and logs an event.

```ts
store.log("Nightly sync finished");
ui.write();
```

**Test**

```js
import assert from "node:assert/strict";
import { testUi } from "mcp-projection/testing";
import { createServer } from "./dist/server.js";

const t = await testUi(createServer);
assert.ok(t.resourceUri);
assert.ok(!t.modelTools.some((x) => x.name === "p_sync"));
const v = await t.mount();
await t.agent.callTool({ name: "add_task", arguments: { title: "Write skill" } });
await v.until((_, html) => html.includes('id="tasks-1"'));
await v.click("set_status", { id: 1, status: "doing" });
await v.until((text) => text.includes("Task 1 is now doing"));
await v.set({ q: "nomatch" });
await v.until((text) => text.includes('Nothing matches "nomatch"'));
await assert.rejects(v.click("set_status", { id: 99, status: "done" }));   // handler throws
await assert.rejects(v.click("set_status", { id: "1", status: "done" }));  // zod rejects a string id
v.close(); await t.close(); process.exit();
```

---

## 19. Checklist

Before you call it done:

- [ ] `ui.attach` runs before every tool registration, on every server instance.
- [ ] The tool snapshot comparison reports OK (only `web.tool` may be new).
- [ ] The view returns `html`, reads params defensively and can't throw.
- [ ] Repeating elements have stable, page-unique ids.
- [ ] Numbers from forms are coerced in the schema, or sent in `args`.
- [ ] Destructive actions have a confirm dialog.
- [ ] Tools that change nothing are `readOnlyHint`; changes outside tools call `ui.write()`.
- [ ] Per-user data is filtered by `user`, and tools use `ui.identify(extra)`.
- [ ] Empty states say how to fill them; icon-only buttons have labels.
- [ ] Previewed in light, dark and at a narrow width.
- [ ] A `testUi` test covers an agent write showing up live and at least one human action.
