---
name: mcp-projection
description: Add a live, server-rendered UI for humans to an existing TypeScript MCP server with the mcp-projection library, without changing the tools, schemas or results the model sees. Covers checking fit, installing the library, deciding what the UI should show, writing ui.ts (fragments, components, writes), attaching it to McpServer, optional web mode, and testing, previewing and proving the agent surface is unchanged. Use when someone wants a UI, dashboard, admin panel, live view or MCP App for an MCP server, mentions mcp-projection, projection, defineUi or ui.attach, or wants people to watch and act on what an agent does through MCP tools.
---

# Add a UI to an MCP server with mcp-projection

`mcp-projection` adds a second view of an MCP server for the people working with the agent. It shows up inside MCP Apps hosts (Claude, ChatGPT, VS Code) and, optionally, on a normal URL. The model's view of the server doesn't change.

- **UI = f(data).** Fragments are server functions that `read()` data and return HTML. Nothing renders in the browser.
- **Actions are the existing tools.** `Button({ tool: "pin_note", args: { id } })` runs the same handler the agent runs.
- **Live updates come from writes.** `writes: { add_note: ["notes"] }` means after any call to `add_note`, from the agent or a human, every open fragment that read `notes` re-renders and is pushed to every screen.

`<skill-dir>` below means the folder that contains this file.

## 1. Check fit before doing anything

All of these must hold. If one fails, stop and tell the user what would have to change.

- Node 20+, TypeScript or JavaScript, ES modules.
- The server uses `McpServer` from `@modelcontextprotocol/sdk` (1.20+) with zod (3.25+ or 4).
- Not a low-level `Server` with its own `tools/call` handler, and not Python or another runtime.
- One server process (state is in memory; several replicas behind a load balancer won't share updates).

Two things are fixable and common:

- **`server.tool(...)` registrations are invisible to projection.** They don't go through `registerTool`. Any tool the UI will call, list in `writes` or `attachTo` must be converted to `server.registerTool(name, { description, inputSchema, annotations }, handler)`. That form lists identically; the snapshot in step 2 proves it.
- **No server factory.** Tests need `export function createServer()` that builds the server, registers tools and returns it, with `connect(transport)` left in the entry file. Make that move if the server is built at module top level. Change nothing else.

## 2. Workflow

Copy this list into your task list and work through it in order.

1. Survey the server
2. Snapshot what the model sees
3. Install the library
4. Design the UI (write a short plan)
5. Write `src/ui.ts`
6. Attach it to the server
7. Build and test
8. Preview and look at it
9. Compare the snapshot
10. Web mode, if wanted
11. Report back

### Step 1: Survey the server

Find, and note down:

- `package.json`: SDK and zod versions, module type, build command, the command that starts the server (for example `node dist/index.js` or `npx tsx src/index.ts`), and the package manager (lockfile).
- Where `new McpServer(` is constructed, whether a factory exists, and whether a new server is created per session or request.
- Every tool registration: name, `registerTool` or `.tool(`, its arguments, whether it reads or changes data, and which store or database functions it calls.
- The data layer the tools use (store module, ORM, API client). Loaders will call it directly.
- The transport (stdio, Streamable HTTP) and the entry file.
- Whether requests carry authentication (`authInfo`). Without it every viewer is the same user, `"local"`.
- Anything that changes data outside tools: cron jobs, webhooks, queues, background workers.

```bash
grep -rnE "registerTool\(|\.tool\(|new McpServer|StdioServerTransport|StreamableHTTPServerTransport|authInfo" src
```

### Step 2: Snapshot what the model sees

Build the server, then record its model-visible tools before changing anything. Run from the server's project folder (the script finds the SDK there) and put the server's start command after `--`. Save the file outside the repo.

```bash
node <skill-dir>/scripts/tool-snapshot.mjs --out /tmp/projection-before.json -- node dist/index.js
```

For an HTTP-only server, start it and use `--url http://localhost:3000/mcp` instead of `-- command`. `--calls calls.json` (a JSON array of `[toolName, args]`) also records results; only include calls that are safe to run against the server's data, such as reads against a test database.

### Step 3: Install the library

```bash
npm install github:jarrod/projection
```

Use the project's package manager (`pnpm add`, `yarn add`) if it isn't npm. Then confirm the build exists:

```bash
ls node_modules/mcp-projection/dist/index.js
```

npm 11 may warn that `mcp-projection`'s `prepare` script isn't covered by `allowScripts`. If `dist/index.js` exists, ignore it. If it doesn't, build a tarball and install that:

```bash
git clone --depth 1 https://github.com/jarrod/projection /tmp/projection && cd /tmp/projection && npm install && npm run build && npm pack
```

```bash
npm install /tmp/projection/mcp-projection-0.2.0.tgz
```

The installed package includes `AGENTS.md` and the full guide at `docs/guide.md`.

### Step 4: Design the UI

Read [references/design.md](references/design.md). Then write a plan in this shape:

```
Who and when:      <who opens it, and the moment the agent shows it>
At a glance:       <what they must understand in five seconds>
Data keys:         <key → loader (store function)>
Fragments:         app (reads nothing) → <leaf: keys it reads>, ...
Actions:           <element → tool → args>, ...
writes:            <tool → keys>, for every tool that changes data
attachTo:          <the read tool after which a person wants to look>
App-only tools:    <ui_* tools for search, filters, paging, selection>
Outside writes:    <where ui.write(key) goes for cron/webhooks/workers>
```

If the request was open-ended ("add a UI") or the server has more than about eight tools, show the plan to the user and ask before building. If they gave a clear spec, carry on.

### Step 5: Write `src/ui.ts`

Start from [assets/ui.template.ts](assets/ui.template.ts). Check exact props and options in [references/api.md](references/api.md) and copy patterns from [references/recipes.md](references/recipes.md). Keep all UI code in this one file.

### Step 6: Attach it to the server

The only edits to existing code:

```ts
import { ui } from "./ui.js";
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));   // BEFORE any registerTool
```

- Call `ui.attach` on every server instance (per-session servers are fine), before the first `registerTool`.
- Convert `server.tool(...)` to `registerTool` for tools the UI uses (step 1).
- Register app-only `ui_*` tools after the existing ones, with `_meta: { ui: { visibility: ["app"] } }`.
- Add `ui.write("key")` where data changes outside tools.

### Step 7: Build and test

Write a test from [assets/ui.test.mjs](assets/ui.test.mjs). Follow the project's test setup if it has one; otherwise add a plain Node script and run it after building. It must cover: the UI mounts, an agent call shows up live, a human action works, and the model's tool list has no `p_*` or `ui_*` tools.

Treat every `[mcp-projection]` warning printed during the test as a failure and fix it.

### Step 8: Preview and look at it

Copy [assets/preview.mjs](assets/preview.mjs) next to the build output, seed realistic data through the project's own store, and run it. It writes light, dark and 420 px narrow HTML files. Screenshot them with whatever browser tool you have, or headless Chrome:

```bash
google-chrome --headless=new --screenshot=preview-light.png --window-size=1040,900 "file://$PWD/preview-light.html"
```

Headless Chrome won't lay out narrower than 500 px, so screenshot `preview-narrow.html` (which frames the page at 420 px) with a 520 px window. Look at every image. Check spacing, alignment, overflow at narrow width, empty states, long text and dark mode. Fix what looks wrong and look again. Delete the preview files when done.

### Step 9: Compare the snapshot

```bash
node <skill-dir>/scripts/tool-snapshot.mjs --compare /tmp/projection-before.json -- node dist/index.js
```

It must print `OK`. The only acceptable new model-visible tool is the one named by `web.tool`. If anything else changed, find the edit that caused it and undo it.

### Step 10: Web mode, if wanted

Only if the user wants the UI on a URL. See "Web mode" in [references/api.md](references/api.md) and the deployment recipes in [references/recipes.md](references/recipes.md). Web mode adds one model-visible tool if you set `web.tool`; mention that to the user.

### Step 11: Report back

Tell the user:

- which files changed, and that existing tools are untouched (with the snapshot result);
- how to see the UI: in a host, by asking the agent to call the `attachTo` tool; on the web, through the `web.tool` or `ui.site.link(user)`;
- what was tested and what wasn't (projection hasn't been tried in every host);
- limits that apply: one process, and identity is `"local"` without authentication.

## 3. Hard rules

1. **Never change an existing tool's name, description, schema, annotations or results.** The allowed edits are wrapping construction in `ui.attach(...)`, converting `server.tool()` to an identical `registerTool`, extracting a factory, and adding `ui.write(...)` calls.
2. **`ui.attach(server)` comes before every `registerTool`.**
3. **Every `tool:` used in the UI is in `writes`.** `writes` is also an allow-list, so list only tools a human should run.
4. **UI-only tools are app-only**: `_meta: { ui: { visibility: ["app"] } }`. Don't add model-visible tools for UI needs, other than an explicit `web.tool`.
5. **No client JavaScript.** No `<script>` in fragments; use `Tabs`, `Dialog`, `Menu`, `<details>` and server tools instead.
6. **Escape by default.** Values go through `html`; use `raw()` only for HTML you produced.
7. **Stable, page-unique ids on everything that repeats.** `Table` needs `id` and `rowKey`.
8. **Fragments and loaders never throw.** A throw during a write turns the agent's successful tool call into an error.

## 4. Gotchas that cause most bugs

- **UI calls skip zod.** Projection calls the handler directly with the browser's arguments: no coercion, no `.default()`, no validation. Send numbers and booleans in `args` (JSON keeps types). Form fields arrive as strings. Supply defaults from the UI.
- **A returned `isError` looks like success in the UI.** Only a thrown error shows (`p-error`). If the user should see a failure, add an app-only twin tool that calls the same core function and throws (recipe in recipes.md). Don't change the agent's tool.
- **Tools with no `inputSchema` get the UI's args object in place of `extra`.** If such a handler uses `extra`, don't call it from the UI: add an app-only tool that does the same work. Adding a schema to the existing tool would change what the model sees.
- **No fragment boundary inside `<table>` or `<select>`.** The HTML parser moves it. Per-item fragments go in a list or grid.
- **Don't mount the same fragment with the same params twice on one page.** They share a DOM id.
- **`` ${n && html`...`} `` prints `0` when `n` is 0.** Use `n > 0 &&`.
- **Web mode calls get a minimal `extra`**: `{ authInfo: { extra: { sub } }, ui: "web" }`.
- **End tests with `process.exit()`.** A pending long-poll keeps Node alive for up to 25 s.

Symptoms and fixes: [references/troubleshooting.md](references/troubleshooting.md).

## 5. Files in this skill

| File | Read it when |
|---|---|
| [references/design.md](references/design.md) | Step 4: turning a tool list into a screen, layout patterns, visual rules |
| [references/api.md](references/api.md) | Steps 5, 6, 10: every option, component prop, attribute, token and test API |
| [references/recipes.md](references/recipes.md) | Step 5: tested code for search, confirm dialogs, approvals, run monitors, settings, paging, outside writes, web deployments |
| [references/troubleshooting.md](references/troubleshooting.md) | A warning, an error, or the UI doesn't do what you expect |
| [assets/ui.template.ts](assets/ui.template.ts) | Starting `src/ui.ts` |
| [assets/ui.test.mjs](assets/ui.test.mjs) | Writing the test |
| [assets/preview.mjs](assets/preview.mjs) | Rendering previews with seeded data |
| [scripts/tool-snapshot.mjs](scripts/tool-snapshot.mjs) | Steps 2 and 9 |
