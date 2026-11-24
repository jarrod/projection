# Writing UIs for MCP servers

A guide to adding a human interface to an MCP server with `mcp-projection`: how it works, how to decide what the UI should show, how to build and test it, and what to avoid. It is written for developers and for coding agents doing the work for them.

If you only need the API, read [AGENTS.md](../AGENTS.md). If you want an agent to do the integration, give it the skill in [`skills/mcp-projection`](../skills/mcp-projection/SKILL.md).

**Contents**

1. [How it works](#1-how-it-works)
2. [Before you start](#2-before-you-start)
3. [Integrate in five steps](#3-integrate-in-five-steps)
4. [Design the UI](#4-design-the-ui)
5. [Fragments and data](#5-fragments-and-data)
6. [Writing HTML](#6-writing-html)
7. [Components](#7-components)
8. [Actions: how the UI changes things](#8-actions-how-the-ui-changes-things)
9. [State in the browser, without JavaScript](#9-state-in-the-browser-without-javascript)
10. [Live updates](#10-live-updates)
11. [Users and identity](#11-users-and-identity)
12. [Styling and theming](#12-styling-and-theming)
13. [Read-only UIs](#13-read-only-uis)
14. [Web mode](#14-web-mode)
15. [Testing and checking](#15-testing-and-checking)
16. [Performance and size](#16-performance-and-size)
17. [Security](#17-security)
18. [Pitfalls](#18-pitfalls)
19. [Worked example: a tasks server](#19-worked-example-a-tasks-server)
20. [Checklist](#20-checklist)

---

## 1. How it works

An MCP server has two audiences. The model calls its tools. The people working with that model want to see what is going on and sometimes act directly. Projection serves the second audience from the same server and the same tools, without changing anything the model sees.

Three ideas carry the whole design:

- **UI = f(data).** A *fragment* is a server function that reads data and returns HTML. Nothing renders in the browser.
- **Actions are your existing tools.** A button with `tool: "pin_note"` runs the same handler the agent runs.
- **Live updates come from writes.** You list which tools change which data keys. After any call to one of those tools, from the agent or a human, every open fragment that read those keys re-renders, and the HTML is pushed to every open screen.

### Where the UI appears

| Surface | How it is reached | Transport |
|---|---|---|
| MCP Apps hosts (Claude, ChatGPT, VS Code and others that support the extension) | The agent calls a tool listed in `attachTo`. The host sees `_meta.ui.resourceUri` on that tool, fetches the `ui://` resource and shows it in a sandboxed frame. | MCP: the frame calls app-only tools through the host |
| A normal URL (optional, "web mode") | A single-use link minted by the server, usually sent through MCP URL elicitation so it never enters the model's context | HTTP: POST for actions, server-sent events for updates |

### What `ui.attach(server)` adds

| Added | Visible to the model? | Purpose |
|---|---|---|
| Resource `ui://<name>/app.html` | No | The shell: kit CSS plus the browser runtime (about 2.4 KB gzipped) |
| `_meta.ui.resourceUri` on each `attachTo` tool | No (`_meta` is for hosts) | Tells the host to open the UI when that tool runs |
| Tool `p_mount` | No (`visibility: ["app"]`) | First render; returns HTML and a client id |
| Tool `p_sync` | No | Long-polls for patches (waits up to 25 s) |
| Tool `p_call` | No | Runs one of your `writes` tools for the UI. Not registered when `readOnly` |
| Tool named by `web.tool` | **Yes**, and only if you ask for it | Sends the human a link to the web UI |

It also wraps `server.registerTool` so it can capture handlers as you register them. The wrapper passes your config through unchanged (except the `_meta` addition for `attachTo` tools) and returns your handler's result untouched.

### One update, step by step

The agent calls `add_note`:

1. The wrapped handler runs your handler and keeps its result.
2. Because `writes` says `add_note: ["notes"]`, it calls `engine.write("notes")` and **waits** for the render pass.
3. The engine finds every fragment instance that read `notes` and has an open client. Writes in the same tick merge into one pass.
4. Each of those fragments re-renders. Loaders are memoized for the pass, so ten fragments reading `notes` cost one load per user.
5. If a fragment's HTML is identical to last time, nothing is sent for it.
6. Changed fragments become patches `{ id, html, seq }` queued for each client.
7. The pending `p_sync` (host) or event stream (web) delivers them. The runtime morphs each fragment in place and briefly highlights rows that changed.
8. The handler's original result goes back to the agent.

A human click is the same path started from the other side: the runtime calls `p_call` with the tool name and arguments, your handler runs, the write renders, and the patches come back **in the same response**, so the person who clicked sees the result without waiting for the next poll.

---

## 2. Before you start

Projection fits when all of these hold:

- **Node 20 or later**, TypeScript or JavaScript, ES modules.
- The server uses **`McpServer` from `@modelcontextprotocol/sdk`** (1.20 or later) with **zod** (3.25 or later, or 4).
- Tools you want the UI to call, or that should refresh it, are registered with **`server.registerTool(...)`**.

Check these before writing any UI code:

**`server.tool(...)` registrations are invisible to projection.** The SDK's older `tool()` method doesn't go through `registerTool`, so `ui.attach` never sees those handlers. Convert the ones you need. The two forms below list identically to the model:

```ts
// before
server.tool("pin_note", "Toggle pin on a note", { id: z.number() }, async ({ id }) => { ... });
// after
server.registerTool("pin_note", { description: "Toggle pin on a note", inputSchema: { id: z.number() } }, async ({ id }) => { ... });
```

If `tool()` was given annotations, move them to `annotations` in the config. Run the tool snapshot (section 15) before and after to prove nothing changed.

**A low-level `Server` with its own `tools/call` handler doesn't fit.** `ui.attach` needs `registerTool` and `registerResource`. Move to `McpServer` first, or don't use projection.

**Python, Go and other runtimes are not supported.** Projection is a TypeScript library that runs inside the server process.

Also worth knowing:

- Put server construction in a factory (`export function createServer()`) that registers tools and returns the server, and keep `server.connect(transport)` in the entry file. The test harness needs the factory. If your server builds itself at module top level, this small move is the one structural change worth making.
- Create **one** `ui` with `defineUi` at module level and call `ui.attach` on **each** server instance. Per-session servers are fine. Calling `attach` twice on the same server throws, and two different `ui`s can't share a server (both would register `p_mount`).
- State lives in memory in one process. Running several server processes behind a load balancer needs a shared change feed, which projection doesn't have yet.

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
npm install ./projection/mcp-projection-0.2.0.tgz
```

`@modelcontextprotocol/sdk` and `zod` are peer dependencies. Your server already has them.

### Step 2: Snapshot what the model sees

Before changing anything, record the model-visible tools so you can prove later that they didn't change. The package ships a script for this:

```bash
node node_modules/mcp-projection/skills/mcp-projection/scripts/tool-snapshot.mjs --out .projection-before.json -- node dist/index.js
```

Run it from your server's project folder (it finds the SDK there), with the command that starts your server after `--`. Section 15.4 covers the options.

### Step 3: Write `src/ui.ts`

Keep all UI code in this one file (split it later if it grows past a few hundred lines).

```ts
import { defineUi, html, Header, Button, Table } from "mcp-projection";
import { store } from "./store.js";

export const ui = defineUi({
  name: "notes",
  load: { notes: () => store.list() },                  // data keys → loaders
  writes: { add_note: ["notes"], pin_note: ["notes"] }, // tool → keys it changes; also the UI's allow-list
  attachTo: ["list_notes"],                             // tools whose results open the UI in hosts
});

ui.fragment("app", async ({ read }) => html`
  ${Header({ title: "Notes" })}
  ${Table({
    id: "notes", rows: await read("notes"), rowKey: (n) => n.id,
    columns: [
      { label: "Title", key: "title" },
      { label: "", cell: (n) => Button({ size: "sm", tool: "pin_note", args: { id: n.id } }, "Pin") },
    ],
  })}`);
```

### Step 4: Attach it, before registering tools

```ts
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
server.registerTool("add_note", /* exactly as before */);
```

This is the only change to existing code. Order matters: tools registered before `attach` aren't captured.

### Step 5: Verify

1. Build and run a `testUi` test (section 15): the UI mounts, an agent call updates it, a click works.
2. Render a preview and look at it in light and dark.
3. Compare the tool snapshot: run the same command with `--compare .projection-before.json` instead of `--out`. It must report OK.

---

## 4. Design the UI

The tool list tells you what the system *can* do. It doesn't tell you what a person needs to *see*. Design from the person.

### 4.1 Start from the person and the moment

Answer these before choosing components:

1. **Who opens this, and when?** In a host, the UI appears when the agent calls an `attachTo` tool, inside the conversation. On the web, it's a page someone keeps open beside their work. The first is a glance; the second is a workspace.
2. **What should they understand in five seconds?** Usually: what exists, what state it's in, what changed, and whether anything needs them.
3. **What is faster by hand than by asking the agent?** Toggling, approving, fixing a typo, reordering, deleting one thing. These become actions.
4. **What must a human decide?** Approvals, destructive changes and anything the agent shouldn't do alone. Make these explicit, with a confirm step.
5. **What would they otherwise ask the agent to re-list?** That's the main view.

Write the answers down in a few lines. They decide everything below.

### 4.2 Map the tool surface

| What you have | What it becomes |
|---|---|
| Data the read tools return (`list_*`, `get_*`, `status`) | **Loaders** in `load`. Call the store directly, not the tool: tools return text for a model, loaders return typed objects for HTML. |
| Tools that change data (`add_*`, `update_*`, `set_*`, `delete_*`) | **`writes`** entries, so agent calls refresh the UI. Add them to the UI as **actions** only where a human should do them by hand. |
| The tool an agent calls when a person would want to look | **`attachTo`**. Usually one read tool, such as the main `list_*` or a status tool. |
| UI needs the agent shouldn't see (search text, filters, sort, selection, page) | **App-only tools** with `_meta: { ui: { visibility: ["app"] } }`, plus a per-user data key. See section 8.6. |
| Changes that come from outside tools (cron, webhooks, queues, other processes in the same server) | **`ui.write(key)`** where the change happens. |

Don't add a tool for the agent just because the UI needs it, and don't change an agent tool's behaviour to suit the UI. The agent's surface stays exactly as it was.

### 4.3 Choose data keys

A data key names a thing that changes together.

- **Collection keys** (`notes`, `tasks`, `runs`): the default. One write refreshes every reader.
- **Item keys** (`read("note", id)`): fragments that show one item subscribe to `note:<id>`. `ui.write("note:42")` refreshes only readers of note 42, while `ui.write("note")` refreshes readers of every note.
- **Per-user keys**: loaders receive `{ user }`, so `mine: ({ user }) => store.forUser(user)` gives each viewer their own data.
- **View keys** for UI state (`view: ({ user }) => views.get(user)`), written by app-only tools.

Loaders run *while the agent's tool call waits* (step 2 of the update above), so keep them fast and make sure they can't throw. If a load is slow, cache it in your store, not in the fragment.

`writes` entries name whole keys (`["notes"]`). To refresh one item after a tool call, call `` ui.write(`note:${id}`) `` yourself where the change happens. Usually a collection key is enough.

### 4.4 Split the page into fragments

A fragment re-renders **completely** when anything it read changes, **including every child it mounted with `frag()`**, and its whole HTML is sent as one patch. So:

- **Make the root fragment a shell that reads nothing.** It lays out the page, holds dialogs, and mounts children. Because it reads nothing, it never re-renders.
- **Read data in the leaves.** Each leaf reads only what it shows. In the notes example, `stats` and `list` both read `notes`; `app` reads nothing.
- **One fragment per independently changing region**: a stats row, a list, an activity feed, a detail panel.
- **Use params for variants**: `frag("list", { filter: "pinned" })` is a separate instance with its own DOM id (`list?filter=pinned`).
- **Never put a fragment boundary inside `<table>`, `<tbody>`, `<tr>` or `<select>`.** The browser's HTML parser moves the `<p-f>` wrapper out of the table on first render and drops the row tags from patches. Make the whole table one fragment, or use a list (`<ul>`, a grid of cards) for per-item fragments.
- **Don't mount the same fragment with the same params twice on one page.** Both copies get the same DOM id and only the first one updates.

The notes example's tree:

```
app (reads nothing: header, tabs, dialog)
├── stats                 reads notes
├── list                  reads notes
└── list?filter=pinned    reads notes
```

### 4.5 Layout patterns

These cover most MCP servers. Build with the kit components (section 7).

| Pattern | When | Build it with |
|---|---|---|
| **Overview** | Counts and health at a glance | `Header`, `Grid` of `Stat` (with `tone` and `delta`), a `Card` per area |
| **Collection** | The main list of things the agent manages | `Card({ flush: true })` around a `Table` with `id` + `rowKey`, `Badge` for status, `sm`/`ghost` buttons in the last column, `Empty` when there are no rows |
| **Queue** | Things waiting on a human (approvals, reviews) | A `Table` filtered to pending items with explicit Approve (`variant: "primary"`) and Reject (`secondary`) buttons; a `Stat` with the count in the header |
| **Activity feed** | What the agent did recently | A `<ul>` of `<li id="...">` rows with `Mono` timestamps; new rows flash on arrival |
| **Run monitor** | Long jobs | `Dot({ tone, pulse: true })` for running, `Badge` for state, `Stat` for progress; the store calls `ui.write("runs")` as the job advances |
| **Detail** | One item's full content | A per-row `Dialog` opened by a button, or a separate fragment with an item key |
| **Settings** | A handful of switches the agent reads | `Card` with `Checkbox({ switch: true, tool })` and `Select({ tool })` |

Use `Tabs` to put two or three views of the same data on one page (All / Pinned). Selection is kept in the browser and survives live updates.

### 4.6 Visual rules

The kit is hairline, monochrome and dense. It looks right if you stay inside it:

- **Colour means state.** Use `tone` (`ok`, `warn`, `bad`, `info`) only for status, never for decoration.
- **One primary button per view** (the default variant). Everything else is `secondary` or `ghost`. Destructive confirmations are `danger`.
- **Small controls in tables**: `size: "sm"`, `variant: "ghost"`, often icon-only with a `label`.
- **Icon-only buttons need `label`.** It becomes the `aria-label` and the tooltip.
- **Empty states say how to fill them**: "No notes yet. Ask your assistant to add one, or create it here."
- **Say it's live** when it matters: `Dot({ tone: "ok", pulse: true, label: "Live" })` next to "Shared with your assistant".
- **Sentence case, short labels**, numbers in `Mono` or table columns with `mono: true`.
- **Constrain width** on wide screens: wrap the shell in `<div class="stack" style="--gap:20px;max-width:880px;margin:0 auto">`.
- **Keep it narrow-friendly.** Hosts often show the UI in a column a few hundred pixels wide. `Grid` and `Row` wrap; tables scroll horizontally.

---

## 5. Fragments and data

### 5.1 `defineUi` options

| Option | Default | Meaning |
|---|---|---|
| `name` | required | Short name. Default resource URI is `ui://<name>/app.html` |
| `load` | required | `{ key: (ctx: { user, id? }) => data }`. Types flow into `read()` |
| `writes` | `{}` | `{ toolName: ["key", ...] }`. Calls refresh readers of these keys. Unless `readOnly`, also the only tools the UI may call |
| `attachTo` | none | Tool names that open the UI in hosts |
| `readOnly` | `false` | No `p_call`, smaller runtime, web links are read-only |
| `root` | `"app"` | Name of the root fragment |
| `css` | none | CSS appended after the kit |
| `bare` | `false` | Drop the kit CSS entirely |
| `identify` | `authInfo.extra.sub` → `authInfo.clientId` → `"local"` | Maps an MCP request's `extra` to a user id |
| `uri` | `ui://<name>/app.html` | Override the resource URI |
| `dev` | `NODE_ENV !== "production"` | Development warnings |
| `web` | none | Serve the UI on a URL too (section 14) |

### 5.2 The fragment context

```ts
ui.fragment("list", async ({ user, params, read, frag }) => html`...`);
```

| Field | Meaning |
|---|---|
| `user` | Viewer's id (from `identify` in hosts, from the link in web mode) |
| `params` | `Record<string, string>` passed by the parent's `frag(name, params)`. The root fragment always gets `{}` |
| `read(key, id?)` | Loads data and subscribes this fragment to `key` (or `key:id`). Typed from `load` |
| `frag(name, params?)` | Renders a child fragment, which then updates on its own |

`ui.fragment` returns the `ui`, so calls can be chained.

### 5.3 Loading

- `read("notes")` calls `load.notes({ user })`; `read("note", 42)` calls `load.note({ user, id: "42" })`. The id always arrives as a string.
- Results are memoized per render pass by user, key and id. Read freely.
- Loaders may be sync or async.
- `read` of a key that isn't in `load` throws `No loader for "y". Add it to defineUi({ load: ... }). Known: ...`.

### 5.4 Writing

- `writes: { tool: ["key"] }` handles tool calls from both the agent and the UI.
- `ui.write("key")` handles everything else. It returns a promise that resolves when the render pass is done.
- `write("note")` refreshes readers of `note` and every `note:<id>`. `write("note:42")` refreshes only readers of `note:42`.
- All writes in the same tick merge into one pass.
- Only fragments with an open client re-render. With no UI open, a write costs almost nothing.
- A fragment whose HTML didn't change sends nothing.

### 5.5 Fragments must not throw

The render pass runs inside the agent's tool call. **If a loader or fragment throws during a write, the agent's call returns `isError` with your exception's message, even though the tool's own work already succeeded.** The agent then thinks the tool failed. That breaks the core promise that agent results never change.

So loaders and fragments must not throw. Handle missing data in the fragment:

```ts
ui.fragment("card", async ({ read, params }) => {
  const t = await read("task", params.id);
  if (!t) return html``;                 // deleted since the parent rendered
  return Card({ title: t.title }, ...);
});
```

Wrap anything that might fail, such as remote calls or parsing:

```ts
ui.fragment("billing", async ({ read }) => {
  try {
    const usage = await read("usage");
    return Stat({ label: "This month", value: usage.total });
  } catch (e) {
    console.error("[ui] billing", e);
    return Muted("Usage is unavailable right now.");
  }
});
```

---

## 6. Writing HTML

### 6.1 `html` escapes by default

```ts
html`<p title="${note.title}">${note.body}</p>`   // both values escaped
```

| Value | Renders as |
|---|---|
| string, number | escaped text (`0` renders "0") |
| `null`, `undefined`, `false`, `true` | nothing |
| array | each item rendered and joined |
| `Html` (from `html`, `raw`, components) | inserted as is |

Two consequences:

- **Conditionals need booleans.** `` ${items.length && html`...`} `` renders "0" when the list is empty. Write `` ${items.length > 0 && html`...`} ``.
- **Quote attribute values.** Escaping covers quotes, so quoted attributes are safe. Unquoted ones are not.

### 6.2 Helpers

| Helper | Use |
|---|---|
| `raw(s)` | Trusted HTML you produced yourself (an SVG, sanitized markdown). Never user input |
| `esc(v)` | Escape a value to a string outside a template |
| `attrs({...})` | Attributes from an object: `true` → bare attribute, `false`/`null`/`undefined` → omitted, objects → JSON (good for `hx-vals`) |
| `cx(...)` | Join class names, skipping falsy values |

```ts
html`<li${attrs({ id: `t-${t.id}`, class: cx("row", t.done && "muted"), "hx-tool": "toggle", "hx-vals": { id: t.id } })}>${t.title}</li>`
```

### 6.3 What not to put in fragments

- **`<script>`**: it never runs. Patches are parsed in a way that leaves scripts inert, and web mode's Content Security Policy blocks inline scripts. There is no place for your own browser JavaScript.
- **External images, fonts or stylesheets**: web mode's CSP allows only same-origin and `data:` images, and no external fonts or stylesheets. Hosts sandbox the frame, and projection declares no extra domains. Use inline SVG (`Icon` or `raw` SVG) and `data:` URIs.
- **User-supplied URLs in `href` without checking the scheme.** Escaping doesn't stop `javascript:` links. Allow only `https:` and `mailto:`.

Inline `style` attributes are fine and common for one-off layout (`style="--gap:6px"`).

---

## 7. Components

Components are server-side functions that return escaped `Html`. Children are passed as extra arguments and can be strings, numbers, `Html` or arrays.

### Layout

| Component | Props | Notes |
|---|---|---|
| `Stack(props, ...children)` | `gap?` (px) | Vertical flex, default gap 12 |
| `Row(props, ...children)` | `gap?`, `between?` | Horizontal flex, wraps; `between` spreads items |
| `Grid(props, ...children)` | `min?` (px, default 180), `gap?` | Responsive auto-fit columns |
| `Separator()` | | Hairline |
| `Header({ title, description?, actions? })` | | Page title row with actions on the right |
| `Card(props, ...children)` | `title?`, `description?`, `actions?`, `footer?`, `flush?`, `id?` | `flush` removes body padding (use around tables) |

### Controls

All controls accept the action props `tool`, `args` and `close` (section 8).

| Component | Props | Notes |
|---|---|---|
| `Button(props, ...children)` | `variant?` (`primary` default, `secondary`, `ghost`, `danger`), `size?` (`sm`, `md`), `icon?`, `label?`, `opens?`, `type?`, `disabled?`, `id?` | No children + `icon` = icon-only button (pass `label`). `opens` toggles a `Dialog` or `Menu` by id |
| `Form(props, ...children)` | `id?`, `keepValues?` | Submits its fields plus `args` to `tool`; resets after success unless `keepValues` |
| `Input(props)` | `name`, `label?`, `hint?`, `required?`, `placeholder?`, `disabled?`, `type?`, `value?`, `autofocus?`, `debounce?` | With `tool` + `debounce`, calls the tool as you type |
| `Textarea(props)` | `name`, `label?`, `hint?`, `required?`, `placeholder?`, `disabled?`, `value?`, `rows?` | |
| `Select(props)` | `name`, `options` (strings or `{ value, label }`), `value?`, `label?`, `hint?`, `disabled?` | With `tool`, calls it on change with `{ [name]: value }` |
| `Checkbox(props)` | `name`, `label?`, `checked?`, `switch?`, `disabled?` | With `tool`, calls it on change with `{ [name]: true/false }` |

### Display

| Component | Props | Notes |
|---|---|---|
| `Badge(props, ...children)` | `tone?`, `outline?`, `dot?` | Status pill |
| `Dot(props)` | `tone?`, `pulse?`, `label?` | Status dot; `label` makes it accessible |
| `Stat({ label, value, delta?, tone? })` | | Big number; `tone` colours `delta` |
| `Table(props)` | `id?`, `rows`, `columns`, `rowKey?`, `empty?` | Row ids are `${id}-${rowKey(row)}`. If `rows` is empty and `empty` is given, renders `empty` instead |
| `Empty({ title, description?, action?, icon? })` | | Empty state with an optional button |
| `Skeleton({ lines?, width? })` | | Loading placeholder |
| `Kbd(key)`, `Muted(...)`, `Mono(...)` | | Small text helpers |
| `Icon(name)` | | `plus check x more chevron down search trash pin external refresh` |

Table columns: `{ label, key?, cell?, align?: "left" | "right", mono?, width? }`. Use `key` for a plain field or `cell: (row) => ...` for anything else.

### Overlays and tabs

| Component | Props | Notes |
|---|---|---|
| `Dialog(props, ...children)` | `id`, `title`, `description?` | Modal popover. Open with `Button({ opens: id })`. Closes on Escape and outside click |
| `Close(id, label = "Cancel")` | | A secondary button that closes the dialog |
| `Menu({ id, items })` | items: `{ label, icon?, kbd?, danger?, href?, tool?, args?, close? }` or `"-"` for a divider | Dropdown opened by `Button({ opens: id })`. Tool items close the menu by default |
| `Tabs({ id, tabs, selected? })` | `tabs: { label, content }[]`, up to 6 | Selection is kept in the browser |

Inside a dialog, put the buttons in `` html`<div class="actions">...</div>` `` to right-align them.

Tones: `neutral ok warn bad info`.

---

## 8. Actions: how the UI changes things

### 8.1 The basics

Anything with `hx-tool` calls a tool. Components set it for you from `tool`:

```ts
Button({ tool: "pin_note", args: { id: n.id } }, "Pin")
```

The tool must be listed in `writes`. In development you get a warning naming the fix if it isn't, and at run time the call fails with `UI may not call "x". Add it to defineUi({ writes }).`

### 8.2 How arguments are built

| Element | Arguments sent |
|---|---|
| `Button({ tool, args })` | `args` |
| `Form({ tool, args })` on submit | every named field as a **string**, then `args` on top |
| `Input`/`Textarea`/`Select` with `tool` | `{ [name]: value }` (a string), then `args` |
| `Checkbox` with `tool` | `{ [name]: true or false }`, then `args` |
| A checkbox inside a `Form` | `"on"` when checked, absent when not (standard form behaviour) |

`args` always wins, and it keeps JSON types, so numbers and booleans stay numbers and booleans.

### 8.3 UI calls skip input validation

This is the most important rule in this guide.

When the agent calls a tool, the SDK parses the arguments with your zod schema first: it coerces (`z.coerce.number()`), applies defaults (`.default()`) and rejects bad input. **When the UI calls a tool, projection calls your handler directly with the arguments the browser sent. No parsing, no coercion, no defaults, no validation.** (This is how version 0.2 behaves.)

What that means in practice:

- **Send typed values through `args`, not form fields.** `Form({ tool: "delete_task", args: { id: t.id } })`, not a hidden `<input name="id">`, which would arrive as the string `"7"`, and `tasks.find(t => t.id === "7")` finds nothing.
- **Only let form fields fill string parameters.**
- **Supply defaults yourself.** If the schema has `owner: z.string().default("agent")`, a form without an `owner` field sends no `owner`, and your handler receives `undefined`.
- **A `Select`'s value reaches the handler as is.** Its options are the only values a normal user can send, but anyone with dev tools can send any string. If a tool must never receive invalid input, check it in the handler; for the agent, the schema already did.
- **Tools without `inputSchema` get the wrong second argument.** The SDK calls such handlers as `handler(extra)`, but the UI path calls `handler(args, extra)`, so the handler's `extra` is the UI's argument object. If the handler uses `extra`, give the UI a separate app-only tool for it instead.

### 8.4 Triggers

| Element | Default trigger |
|---|---|
| `form` | submit |
| `input`, `select`, `textarea` | change (text fields on blur or Enter; selects and checkboxes as soon as they change) |
| everything else | click |

Override with `hx-trigger`. The components set `hx-trigger="input"` and `p-debounce` for you when you pass `debounce`:

```ts
Input({ name: "q", placeholder: "Search", tool: "ui_set_query", debounce: 250 })
```

While a call is running, the element has `aria-busy="true"`: it ignores clicks, and buttons show a spinner.

### 8.5 After the call

- **Success**: patches from the call are applied at once, forms reset (unless `keepValues`), and `close: true` closes the surrounding dialog or menu.
- **Thrown error**: the element gets `p-error="message"`, which the kit shows in red above it. The next attempt clears it.
- **Returned `isError: true`**: treated as **success** by the UI. Nothing turns red. If your write tools report failures this way (and they often do, for the agent's benefit), make the result visible through data instead: for example, have the store record the last failure and render it in the fragment. Don't change the tool to throw: that would change what the agent sees.

### 8.6 UI-only tools for view state

Search text, filters, sort order, the selected item and the current page are UI concerns. Keep them out of the agent's tool list:

1. Store view state per user in the server.
2. Register an **app-only** tool that sets it. Hosts hide `visibility: ["app"]` tools from the model, exactly like `p_mount`.
3. Add a `view` loader and list the tool in `writes`.
4. Use **the same identity function** in the tool and in `defineUi({ identify })`, so both agree on who the user is.

```ts
// identify.ts
export const userOf = (extra: any): string => extra?.authInfo?.extra?.sub ?? extra?.authInfo?.clientId ?? "local";

// store.ts
export const views = new Map<string, { q: string }>();

// server.ts, after ui.attach(...)
server.registerTool("ui_set_query", {
  description: "UI: set the search query",
  inputSchema: { q: z.string() },
  _meta: { ui: { visibility: ["app"] } },
}, async ({ q }, extra) => { views.set(userOf(extra), { q }); return { content: [{ type: "text", text: "ok" }] }; });

// ui.ts
defineUi({ identify: userOf, load: { ..., view: ({ user }) => views.get(user) ?? { q: "" } }, writes: { ..., ui_set_query: ["view"] } });
```

The list fragment reads both `tasks` and `view` and filters. Prefix these tools (`ui_`) so they're easy to spot. Without authentication every viewer is `"local"`, so they all share one search box. See section 11.

### 8.7 Confirm destructive actions

Without client JavaScript, a confirmation is a dialog per item:

```ts
{ label: "", align: "right", width: "56px", cell: (t) => html`
  ${Button({ variant: "ghost", size: "sm", icon: "trash", label: `Delete task ${t.id}`, opens: `del-${t.id}` })}
  ${Dialog({ id: `del-${t.id}`, title: "Delete task?", description: html`“${t.title}” will be removed for you and your assistant.` },
    Form({ tool: "delete_task", args: { id: t.id }, close: true },
      html`<div class="actions">${Close(`del-${t.id}`)}${Button({ type: "submit", variant: "danger" }, "Delete")}</div>`))}` }
```

Each row carries its own small dialog. For long lists that adds bytes; paginate if it matters (section 16).

---

## 9. State in the browser, without JavaScript

The browser runtime holds no application state. When something must stay in the browser across live updates, use these:

| Need | Use | Why it survives updates |
|---|---|---|
| Switch between views | `Tabs` | Built from radios inside a `p-local` container; the morph doesn't reset inputs there |
| Modal, dropdown | `Dialog`, `Menu` | Native popovers; the morph keeps the same node, so an open popover stays open |
| Expand and collapse | `<details><summary>…</summary>…</details>` | The morph never removes the `open` attribute from `<details>` |
| Your own CSS-only toggle | A checkbox or radio inside an element with `p-local`, plus `:checked` selectors in `css` | Same as tabs |
| An element that must never be touched after first render (an embed, a media player) | Add `p-keep` | The morph skips it entirely, so it also never gets server updates |

Inputs keep what the person is typing: the morph never changes the value of the focused field.

---

## 10. Live updates

### 10.1 The morph

Patches replace a fragment's contents by morphing the DOM in place rather than swapping HTML:

- Elements are matched by **id**, then by position and tag.
- The focused input keeps its value, caret and focus. Other inputs take the server's value.
- Open popovers stay open and `<details open>` stays open.
- `p-local` subtrees keep their input state; `p-keep` elements are never touched.

### 10.2 Ids

Put a stable `id` on anything that repeats: table rows (`Table` does it from `id` + `rowKey`), list items, cards. Without ids, inserting an item at the top makes every row below it "change", which loses hover and focus and flashes the whole list.

Ids must be unique on the page. Two tables showing the same rows need different `id`s (`notes-all`, `notes-pinned`), or their row ids collide.

### 10.3 The highlight

After a patch, the nearest `tr`, `li`, `.stat` or `[p-flash]` around each changed element gets `p-updated` for 900 ms, which the kit animates as a faint flash. Add `p-flash` to any element (a card, a panel) to flash it as a unit. Reduced-motion settings turn the animation off.

### 10.4 Transport

- **Hosts**: the runtime long-polls `p_sync`, which waits up to 25 seconds for patches. Each patch has a sequence number, so nothing is applied twice or missed after a reconnect.
- **Web**: a server-sent event stream with automatic reconnects and backoff.
- Clients that stop syncing for two minutes are dropped. If one comes back, the runtime reloads the frame or page and mounts again.

---

## 11. Users and identity

- In hosts, `identify(extra)` maps each MCP request to a user id. The default is `authInfo.extra.sub`, then `authInfo.clientId`, then `"local"`.
- **Without authentication everyone is `"local"`**: per-user loaders and view state are shared by every viewer. That's fine for a local stdio server with one person. For anything shared, put real MCP authentication in front of the server.
- Each fragment renders per user, and a client id can't be used by another user.
- Per-user data is a loader that uses `user`: `mine: ({ user }) => store.forOwner(user)`.

**Handlers called from web mode get a minimal `extra`**: `{ authInfo: { extra: { sub: user } }, ui: "web" }`. There's no `sendNotification`, `signal`, `requestId` or `sessionId`, and no other `authInfo` fields. If a write tool reads identity from somewhere else (`authInfo.clientId`, a token), it sees nothing in web mode. Either read identity from `authInfo.extra.sub`, or don't offer that tool in web mode. `extra.ui === "web"` tells a handler it was called from the web UI.

---

## 12. Styling and theming

### 12.1 Tokens

Kit tokens fall back to the host's MCP Apps variables, so the UI matches the host's theme without any work:

| Token | Host variable | Use |
|---|---|---|
| `--p-bg`, `--p-bg-2`, `--p-bg-3` | `--color-background-primary/secondary/tertiary` | Surfaces |
| `--p-fg`, `--p-fg-2`, `--p-fg-3` | `--color-text-primary/secondary/tertiary` | Text |
| `--p-line`, `--p-line-2` | `--color-border-primary/secondary` | Hairlines |
| `--p-inv`, `--p-inv-fg` | `--color-background-inverse`, `--color-text-inverse` | Primary buttons |
| `--p-ring` | `--color-ring-primary` | Focus ring, update flash |
| `--p-ok`, `--p-warn`, `--p-bad`, `--p-info` | `--color-text-success/warning/danger/info` | Tones |
| `--p-r`, `--p-r-sm` | `--border-radius-md/sm` | Radii |
| `--p-font`, `--p-mono` | `--font-sans`, `--font-mono` | Type |
| `--p-shadow` | `--shadow-md` | Popovers |

Dark mode follows the host's `theme` (`data-theme="dark"` on the root). On the web it follows the system setting.

### 12.2 Adding CSS

```ts
defineUi({ ..., css: `.lane { min-height: 120px } .lane > h3 { font-size: 12px; color: var(--p-fg-3) }` });
```

Use the tokens so dark mode keeps working. Utility classes in the kit: `stack`, `row`, `between`, `grid`, `grow`, `muted`, `subtle`, `mono`, `sm`, `xs`. Layout components read `--gap` and `--min` from inline styles.

`bare: true` drops the kit entirely. You then own everything, including the rules the runtime relies on: `p-f { display: contents }`, the `[p-updated]` flash, `[aria-busy]` and `[p-error]`.

---

## 13. Read-only UIs

```ts
defineUi({ ..., readOnly: true });
```

- No `p_call` tool, and a smaller runtime (about 1.6 to 1.8 KB gzipped).
- `writes` still refreshes the screen live; it just isn't an allow-list any more.
- Web links are always read-only.
- An `hx-tool` in a read-only UI does nothing, and you get a development warning.

Choose read-only for dashboards and monitors where humans watch and the agent acts.

---

## 14. Web mode

Web mode serves the same fragments on a normal URL, for people who want the UI open in a browser tab rather than inside a chat.

### 14.1 Set it up

```ts
export const ui = defineUi({
  ...,
  web: {
    origin: process.env.UI_ORIGIN ?? "http://localhost:3000", // public origin the browser uses
    tool: "open_notes_in_browser",                             // optional: model-visible tool
    // base: "/ui", linkTtl: 120, sessionTtl: 3600, toolDescription: "..."
  },
});
```

Serve it from any HTTP server:

```ts
// Node http
http.createServer((req, res) => ui.site!.node(req, res)).listen(3000);

// Anything that speaks fetch (Bun, Deno, Hono, Next route handlers)
const response = await ui.site!.fetch(request);   // null when the path isn't under base
```

`site.node(req, res, next)` calls `next()` for paths outside `base` when you pass it, so it works as middleware. With Express, mount it at the app root (`app.use((req, res, next) => ui.site!.node(req, res, next))`) and **before** any body parser: Express strips mount paths from `req.url`, and the adapter reads the request body itself.

### 14.2 How people get in

Only through single-use links that your server mints:

- **The agent tool** (`web.tool`) mints a link for the calling user and asks the host to open it with MCP URL elicitation, so the link goes to the person and never into the model's context. If the client doesn't support URL elicitation, the tool returns the link as text for the agent to pass on.
- **Your own code** can call `ui.site.link(user, { readOnly? })`, or `ui.openInBrowser(extra, { server, readOnly?, message? })` from inside a *new* tool handler. Don't add it to an existing tool: that changes what the agent sees.
- `ui.site.revoke(user)` ends every link and session for a user, for example when their MCP session ends.

### 14.3 Security model

- Opening a link (GET) shows a Continue page, so link previews and unfurlers can't use it up. Continue (POST) redeems it.
- Tokens are stored as SHA-256 hashes. Links expire after `linkTtl` (120 s) and work once.
- The session cookie is HttpOnly, SameSite=Lax, scoped to `base`, and Secure when `origin` is https. Sessions last `sessionTtl` (3600 s).
- API requests need a `P-Req: 1` header, which blocks cross-site form posts.
- Responses carry a strict CSP (`default-src 'none'`, scripts only from the same origin, `frame-ancestors 'none'`), `no-referrer` and `no-store`.
- Web mode trusts the user id your MCP server already has (`authInfo`). It's only as strong as the authentication in front of your MCP server.

### 14.4 Deployment shapes

**stdio server plus a side port** (the example does this): the MCP server talks stdio to the host and also listens on a port for the web UI. Both live in one process, so they share state and writes.

```ts
await createServer().connect(new StdioServerTransport());
if (process.env.UI_PORT) http.createServer((req, res) => ui.site!.node(req, res)).listen(+process.env.UI_PORT);
```

**Streamable HTTP server**: route the MCP endpoint to the transport and everything else to the site, on one listener.

```ts
http.createServer(async (req, res) => {
  if (req.url?.startsWith("/mcp")) {
    const server = createServer();                                   // calls ui.attach inside
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    return transport.handleRequest(req, res);
  }
  return ui.site!.node(req, res);
}).listen(3000);
```

Either way it must be one process (section 2).

---

## 15. Testing and checking

### 15.1 The test harness

`mcp-projection/testing` drives a real server from both sides, with no browser:

```js
import { testUi } from "mcp-projection/testing";
import { createServer } from "./dist/server.js";

const t = await testUi(createServer);          // connects an "agent" client and a "host" client
const view = await t.mount();                   // like a host opening the UI

await t.agent.callTool({ name: "add_note", arguments: { title: "From the agent", body: "" } });
await view.until((text) => text.includes("From the agent"));   // live update arrived

const result = await view.click("pin_note", { id: 1 });        // like a human click; returns the tool result
console.assert(view.html().includes("Pinned"));

console.assert(!t.modelTools.some((x) => x.name.startsWith("p_")));  // app-only tools hidden
view.close(); await t.close();
process.exit(0);
```

| API | Meaning |
|---|---|
| `testUi(factory)` | `factory` returns a server (or a promise of one). It's called **twice** (agent and host), so state must live outside the server object, as it does in a real store |
| `t.agent`, `t.host` | MCP clients |
| `t.tools`, `t.modelTools` | All tools, and tools the model sees (app-only removed) |
| `t.resourceUri` | The UI resource URI found on the `attachTo` tools |
| `t.mount(root?)` | Mounts the UI and keeps it synced. Returns a view |
| `view.html()`, `view.text()` | Current HTML, and its visible text |
| `view.click(tool, args)` | Calls the tool the way `hx-tool` would; returns the tool result, throws on a thrown error |
| `view.until(pred, ms = 2000)` | Waits until `pred(text, html)` is true |

Two things to know:

- `click` doesn't check that a matching button exists. Assert `view.html().includes('hx-tool="pin_note"')` when it matters.
- Finish with `process.exit()`. A pending long-poll on the server can keep Node alive for up to 25 seconds after `t.close()`.

### 15.2 Snapshot the HTML

```js
const html = await ui.render("app", { user: "u1" });              // includes the <p-f> wrapper
const card = await ui.render("card", { params: { id: "2" } });
```

### 15.3 Look at it

Tests prove behaviour; they don't prove it looks right. Render a static, styled page and look at it:

```bash
npx mcp-projection preview dist/ui.js > preview.html
```

```bash
npx mcp-projection preview dist/ui.js list --dark > preview-dark.html
```

Options: a fragment name, `--dark` or `--light`, `--user=<id>`. The page has the kit CSS and no runtime.

The CLI renders whatever your loaders return in a fresh process, often an empty store. To see real content, write a short script that seeds the store and calls `ui.preview()`:

```js
import { writeFileSync } from "node:fs";
import { ui } from "./dist/ui.js";
import { store } from "./dist/store.js";
store.add("Ship the UI layer", "agent");
store.add("Write the guide", "jarrod");
for (const theme of ["light", "dark"]) writeFileSync(`preview-${theme}.html`, await ui.preview("app", { theme }));
process.exit(0);
```

Take a screenshot with any browser, for example headless Chrome (on macOS, the binary is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`):

```bash
google-chrome --headless=new --screenshot=preview.png --window-size=1040,900 "file://$PWD/preview-light.html"
```

Check light and dark, a narrow width (about 420 px, which is common in hosts), empty states and long text. Headless Chrome won't lay out narrower than 500 px: a smaller `--window-size` just crops the screenshot. For a true narrow layout, load the preview in an iframe of that width:

```bash
echo '<body style="margin:0"><iframe src="preview-light.html" style="width:420px;height:900px;border:0"></iframe>' > narrow.html
```

```bash
google-chrome --headless=new --screenshot=narrow.png --window-size=520,900 "file://$PWD/narrow.html"
```

### 15.4 Prove the agent surface didn't change

`tool-snapshot.mjs` (in `skills/mcp-projection/scripts/`, also installed at `node_modules/mcp-projection/skills/mcp-projection/scripts/`) connects to your server as a plain MCP client and records every model-visible tool (everything except `_meta`) and, optionally, the results of some calls.

```bash
node tool-snapshot.mjs --out before.json -- node dist/index.js            # before the UI
node tool-snapshot.mjs --compare before.json -- node dist/index.js        # after
node tool-snapshot.mjs --url http://localhost:3000/mcp --compare before.json
```

`--calls calls.json` (a JSON array of `[toolName, args]`) also records results. Only list calls that are safe against the server's data. With `--compare`, a changed or missing tool, or a different call result, fails with exit code 1. New model-visible tools are listed but allowed, since `web.tool` adds one on purpose; `--strict` makes them fail too.

### 15.5 Development warnings

With `dev` on (the default outside production), projection warns once per problem:

- An `hx-tool` that isn't in `writes`, with the exact line to add.
- A `writes` tool that was never registered after `attach`.
- An `hx-tool` in a read-only UI.

Treat a warning as a failing test.

---

## 16. Performance and size

- The shell (CSS plus runtime) is about 6 KB gzipped. Your `css` adds to it.
- Every patch carries the **whole** fragment's HTML. The morph keeps DOM changes small, but the bytes are the fragment's size. A 500-row table resends 500 rows when one changes.
- For big collections: show the most recent or most relevant N rows, add a page or limit to the view state (section 8.6), or split into per-item fragments in a list (not a table) and use item keys.
- Loaders run during the agent's tool call. A slow loader slows the agent.
- Writes merge per tick, loads are memoized per pass, unchanged HTML isn't sent, and fragments without open clients don't render.

---

## 17. Security

- `html` escapes everything. `raw()` is only for HTML you produced.
- Check URL schemes before rendering user-supplied links.
- UI calls bypass schema validation (section 8.3). Any tool in `writes` can be called with any arguments by anyone who can open the UI. Treat `writes` as a public API and validate in handlers where it matters.
- The UI can only call tools listed in `writes`. Keep the list to what humans should do.
- Without authentication, every viewer is the same user.
- Web mode inherits your MCP server's notion of identity; it doesn't add authentication of its own.

---

## 18. Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Agent calls don't refresh the UI, or a warning says a `writes` tool was never registered | Tools registered before `ui.attach`, or with `server.tool()` | Attach first; convert to `registerTool` |
| A click shows `UI may not call "x"` | Tool missing from `writes` | Add `x: [keys it changes]` |
| UI action does nothing, no error | Handler got a string where it expected a number (no coercion on UI calls) | Pass typed values in `args` |
| A field is `undefined` in the handler | zod `.default()` isn't applied for UI calls | Send the value from the UI |
| Handler failed but the UI shows no error | The tool returned `isError` instead of throwing | Show the failure through data (section 8.5) |
| Agent tool calls start failing with a render error | A fragment or loader threw during the write | Make fragments total; catch inside (section 5.5) |
| A no-argument tool crashes only when clicked | No `inputSchema`, so `extra` is the args object | Use an app-only tool for the UI |
| Whole list flashes on every change | No ids on rows | `Table({ id, rowKey })`, ids on `li` |
| Rows in a second table don't update | Duplicate ids across two tables | Different table `id`s |
| Content of a per-row fragment vanishes or jumps above the table | Fragment boundary inside `<table>` | One fragment for the table, or a list layout |
| Only one of two identical widgets updates | Same fragment and params mounted twice | Different params, or one instance |
| `0` appears on the page | `` ${n && html`...`} `` with `n === 0` | `` ${n > 0 && html`...`} `` |
| Images or fonts missing on the web | CSP blocks external resources | Inline SVG, `data:` URIs |
| Every viewer shares search text | No authentication, so everyone is `"local"` | Add auth, or accept it for single-user servers |
| Tool works from the agent but not from the web UI | It reads `extra` fields that web mode doesn't provide | Read `authInfo.extra.sub`, or don't offer it on the web |
| Express web routes 404 or get an empty body | Mounted under a path, or after a body parser | Mount at the root, before body parsers |
| Test process hangs after finishing | Pending long-poll timer | `process.exit()` |

---

## 19. Worked example: a tasks server

An agent-first task tracker with tools `list_tasks`, `add_task`, `set_status` and `delete_task`. The UI should show counts, a searchable list where a person can change status or delete (with confirmation), and an activity feed of what the agent did.

**Plan**

- Person and moment: a teammate checking on the agent's work; the UI opens when the agent lists tasks.
- Data keys: `tasks` (collection), `task` (item, for a board view), `events` (activity), `view` (per-user search).
- Fragments: `app` (shell, dialogs) → `stats`, `list`, `events`.
- Actions: change status (select), delete (confirm dialog), new task (dialog form), search (app-only tool).
- `attachTo: ["list_tasks"]`.

**`src/identify.ts`**

```ts
export const userOf = (extra: any): string => extra?.authInfo?.extra?.sub ?? extra?.authInfo?.clientId ?? "local";
```

**`src/ui.ts`**

```ts
import { defineUi, html, Header, Button, Badge, Stat, Grid, Table, Dialog, Form, Input, Select, Close, Empty, Card, Stack, Row, Muted, Mono, Dot, type Tone } from "mcp-projection";
import { store, views, type Task, type Status } from "./store.js";
import { userOf } from "./identify.js";

const TONE: Record<Status, Tone> = { todo: "neutral", doing: "info", done: "ok" };

export const ui = defineUi({
  name: "tasks",
  identify: userOf,
  load: {
    tasks: () => store.list(),
    task: ({ id }) => store.get(Number(id)),
    events: () => store.events(),
    view: ({ user }) => views.get(user) ?? { q: "" },
  },
  writes: {
    add_task: ["tasks", "events"],
    set_status: ["tasks", "events"],
    delete_task: ["tasks", "events"],
    ui_set_query: ["view"],
  },
  attachTo: ["list_tasks"],
});

// Shell: reads nothing, so it never re-renders. Dialogs live here.
ui.fragment("app", async ({ frag }) => html`
  <div class="stack" style="--gap:20px;max-width:960px;margin:0 auto">
    ${Header({
      title: "Tasks",
      description: html`<span class="row" style="--gap:6px">${Dot({ tone: "ok", pulse: true, label: "Live" })} Shared with your assistant</span>`,
      actions: Button({ opens: "new-task", icon: "plus" }, "New task"),
    })}
    ${await frag("stats")}
    ${Card({ title: "All tasks", flush: true, actions: Input({ name: "q", placeholder: "Search", tool: "ui_set_query", debounce: 250 }) }, await frag("list"))}
    ${Card({ title: "Activity" }, await frag("events"))}
    ${Dialog({ id: "new-task", title: "New task", description: "Your assistant sees it straight away." },
      Form({ tool: "add_task", args: { owner: "you" }, close: true },
        Input({ name: "title", label: "Title", required: true }),
        html`<div class="actions">${Close("new-task")}${Button({ type: "submit" }, "Create")}</div>`))}
  </div>`);

ui.fragment("stats", async ({ read }) => {
  const tasks = await read("tasks");
  const n = (s: Status) => tasks.filter((t) => t.status === s).length;
  return Grid({ min: 140 },
    Stat({ label: "To do", value: n("todo") }),
    Stat({ label: "Doing", value: n("doing"), tone: "info" }),
    Stat({ label: "Done", value: n("done"), tone: "ok" }));
});

ui.fragment("list", async ({ read }) => {
  const [tasks, view] = await Promise.all([read("tasks"), read("view")]);
  const q = view.q.toLowerCase();
  const rows = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks;
  return Table<Task>({
    id: "tasks", rows, rowKey: (t) => t.id,
    empty: html`<div style="padding:16px">${Empty({ title: q ? `Nothing matches "${view.q}"` : "No tasks yet", description: "Ask your assistant to add one." })}</div>`,
    columns: [
      { label: "#", cell: (t) => t.id, mono: true, width: "48px" },
      { label: "Task", cell: (t) => Stack({ gap: 2 }, html`<strong style="font-weight:500">${t.title}</strong>`, Muted(t.owner)) },
      { label: "Status", width: "140px", cell: (t) =>
        Select({ name: "status", value: t.status, options: ["todo", "doing", "done"], tool: "set_status", args: { id: t.id } }) },
      { label: "", align: "right", width: "56px", cell: (t) => html`
        ${Button({ variant: "ghost", size: "sm", icon: "trash", label: `Delete task ${t.id}`, opens: `del-${t.id}` })}
        ${Dialog({ id: `del-${t.id}`, title: "Delete task?", description: html`“${t.title}” will be removed for you and your assistant.` },
          Form({ tool: "delete_task", args: { id: t.id }, close: true },
            html`<div class="actions">${Close(`del-${t.id}`)}${Button({ type: "submit", variant: "danger" }, "Delete")}</div>`))}` },
    ],
  });
});

ui.fragment("events", async ({ read }) => {
  const events = await read("events");
  if (events.length === 0) return Muted("Nothing yet.");
  return html`<ul class="stack" style="--gap:6px;list-style:none;margin:0;padding:0">${events.map((e) =>
    html`<li id="ev-${e.at}" class="row sm">${Mono(new Date(e.at).toISOString().slice(11, 19))} ${e.text}</li>`)}</ul>`;
});

// Optional board view: one fragment per task in a grid (not a table), so ui.write(`task:${id}`) re-renders one card.
ui.fragment("board", async ({ read, frag }) => {
  const tasks = await read("tasks");
  return html`<div class="grid" style="--min:200px">${await Promise.all(tasks.map((t) => frag("card", { id: String(t.id) })))}</div>`;
});
ui.fragment("card", async ({ read, params }) => {
  const t = await read("task", params.id);
  if (!t) return html``;
  return Card({ title: t.title }, Row({ between: true }, Badge({ tone: TONE[t.status], dot: true }, t.status), Muted(t.owner)));
});
```

Notes on the choices:

- `set_status` gets `id` from `args` (a number) and `status` from the select (a string that the select's options limit). That matches the schema without relying on coercion.
- The new-task form sends `owner` through `args`, because a zod default wouldn't apply to a UI call.
- `events` rows use the event time as the id, so new rows slide in and flash while old ones stay put. If two events can share a millisecond, give events a real id.
- The search tool is app-only, so the model never sees it.

**`src/server.ts`**: the existing tools are unchanged. The two additions are `ui.attach` and the app-only search tool:

```ts
export function createServer() {
  const server = ui.attach(new McpServer({ name: "tasks", version: "1.0.0" }));
  // ...existing registerTool calls, unchanged...
  server.registerTool("ui_set_query", {
    description: "UI: set the search query",
    inputSchema: { q: z.string() },
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ q }, extra) => { views.set(userOf(extra), { q }); return { content: [{ type: "text", text: "ok" }] }; });
  return server;
}
```

**Something changes outside a tool**: a nightly sync finishes and logs an event.

```ts
store.log("Nightly sync finished");
await ui.write("events");
```

**Test**

```js
const t = await testUi(createServer);
const v = await t.mount();
await t.agent.callTool({ name: "add_task", arguments: { title: "Write skill" } });
await v.until((_, html) => html.includes('id="tasks-1"'));
await v.click("set_status", { id: 1, status: "doing" });
await v.click("ui_set_query", { q: "skill" });
console.assert(!t.modelTools.some((x) => x.name === "ui_set_query"));
v.close(); await t.close(); process.exit(0);
```

---

## 20. Checklist

Before you call it done:

- [ ] `ui.attach` runs before every `registerTool`, on every server instance.
- [ ] Every tool in `writes` is registered with `registerTool`; no dev warnings.
- [ ] The tool snapshot comparison reports OK (only `web.tool` may be new).
- [ ] The root fragment reads nothing; leaves read only what they show.
- [ ] No fragment boundary inside a table or select; no fragment mounted twice with the same params.
- [ ] Repeating elements have stable, page-unique ids.
- [ ] UI actions send typed values through `args` and don't rely on zod defaults or coercion.
- [ ] Destructive actions have a confirm dialog.
- [ ] Fragments and loaders can't throw.
- [ ] UI-only state lives behind app-only tools, with one shared `identify` function.
- [ ] Empty states say how to fill them; icon-only buttons have labels.
- [ ] Previewed in light, dark and at a narrow width.
- [ ] A `testUi` test covers an agent write showing up live and at least one human action.
