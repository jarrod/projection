# mcp-projection: notes for coding agents

Add a live, styled UI for humans to an existing MCP server. The UI shows up in MCP Apps hosts (Claude, ChatGPT, VS Code) and, optionally, on a normal URL. Agent-facing tools, schemas and results stay unchanged.

## How it works
- **UI = f(data).** Fragments are server functions that `read()` data and return HTML. Nothing renders in the browser.
- **Actions = your existing tools.** `hx-tool="add_note"` calls the same handler the agent calls.
- **Live updates come from writes.** Listing a tool in `writes` means that after any call to it (agent or human), every fragment that read those keys re-renders and is pushed to open UIs.

## Add it to a server (3 steps)
```ts
// src/ui.ts  ← keep ALL UI code in this one file
import { defineUi, html, Header, Button, Table } from "mcp-projection";
import { store } from "./store.js";

export const ui = defineUi({
  name: "notes",
  load: { notes: () => store.list() },                    // data keys → loaders (typed into read())
  writes: { add_note: ["notes"], pin_note: ["notes"] },   // tool → keys it changes; also the UI's allow-list
  attachTo: ["list_notes"],                               // tools whose results open the UI in hosts
});

ui.fragment("app", async ({ read }) => html`
  ${Header({ title: "Notes" })}
  ${Table({ id: "notes", rows: await read("notes"), rowKey: (n) => n.id,
    columns: [{ label: "Title", key: "title" }, { label: "", cell: (n) => Button({ size: "sm", tool: "pin_note", args: { id: n.id } }, "Pin") }] })}`);
```
```ts
// src/server.ts: the only change to existing code
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));  // BEFORE registerTool calls
```

## Rules
1. Call `ui.attach(server)` **before** `server.registerTool(...)`. It captures handlers as they're registered. Once per server instance is fine (e.g. one server per session).
2. Every `hx-tool` must appear in `writes`. In dev you get a warning naming the fix.
3. If data changes outside a tool (cron, webhook, queue), call `ui.write("notes")`. `write("note:42")` targets only readers of `read("note", 42)`.
4. Put an `id` on anything that repeats (`Table` takes `id` + `rowKey`). Ids let the morph update rows in place, keep focus and highlight only what changed.
5. Escape by default: `html\`` escapes every `${value}`. Use `raw()` only for trusted HTML.
6. No client JavaScript. For interaction use: `hx-tool` (server), popovers (`Dialog`, `Menu`), `Tabs` (radio + CSS), native inputs.

## Data loading
- `load: { key: ({ user, id }) => ... }`, where `user` is the viewer's id (from MCP `authInfo`, or the web session).
- Loads are memoized per render pass: 10 fragments reading `notes` cost one load per user.
- Writes in the same tick merge into one render pass. If a fragment's HTML didn't change, nothing is sent.

## Components (server-only, return Html)
Layout: `Stack Row Grid Separator Header Card`
Controls: `Button Form Input Textarea Select Checkbox` (pass `tool`, `args`, `close`)
Display: `Badge Dot Stat Table Empty Skeleton Kbd Muted Mono Icon`
Overlays: `Dialog` + `Button({ opens: id })` + `Close(id)`, `Menu({ id, items })`, `Tabs({ id, tabs })`
Tones: `neutral ok warn bad info`. Icons: `plus check x more chevron down search trash pin external refresh`.

## Attributes the runtime understands
| attr | meaning |
|---|---|
| `hx-tool="name"` | call tool on click / submit / change |
| `hx-vals='{"id":1}'` | extra args (JSON) |
| `hx-trigger="input"` + `p-debounce="300"` | call while typing |
| `p-close` | close surrounding popover after success |
| `p-keep` | never morph this element (client widget island) |
| `p-local` | client-owned state inside (tabs, toggles not from server) |
| `p-keep-values` | don't reset the form after success |
States set by the runtime: `aria-busy` while calling, `p-error="msg"` on failure, `p-updated` on changed rows.

## Read-only UIs
`defineUi({ ..., readOnly: true })`: no `p_call` tool, a smaller runtime (~1.6–1.8 KB gz), and writes still refresh the screen.

## Web mode (optional): same UI on a URL
```ts
defineUi({ ..., web: { origin: "https://app.example.com", tool: "open_notes_in_browser" } });
http.createServer((req, res) => ui.site!.node(req, res)).listen(3000);   // or: ui.site.fetch(request)
```
- Access only through single-use links minted by the server (`ui.site.link(user)`) or by the opt-in agent tool. That tool uses MCP URL elicitation, so the link goes to the host, not into the model's context. Without elicitation support it falls back to returning the link as text.
- GET on a link shows a Continue page; POST redeems it, then sets an HttpOnly, SameSite=Lax, path-scoped cookie. Tokens are stored hashed.
- `ui.site.revoke(user)` ends a user's links and sessions.

## Testing (no browser)
```ts
import { testUi } from "mcp-projection/testing";
const t = await testUi(createServer);
const view = await t.mount();
await t.agent.callTool({ name: "add_note", arguments: { title: "x", body: "" } });
await view.until((text) => text.includes("x"));
await view.click("pin_note", { id: 1 });           // like a human click
t.modelTools                                         // what the model sees (app-only tools excluded)
```
Snapshot HTML: `await ui.render("app", { user: "u1" })`.

## Visual check
`npx mcp-projection preview dist/ui.js [fragment] [--dark] > preview.html` gives a styled static page (no runtime). Screenshot it.

## Styling
- Tokens (`--p-bg --p-fg --p-line --p-ring --p-r --p-font ...`) fall back to the host's MCP Apps variables (`--color-background-primary`, `--font-sans` ...), so the UI matches the host's theme.
- Add CSS with `defineUi({ css })`. Replace the kit entirely with `bare: true`.

## Not included (by design)
Client routing, client state stores, JSX, a build step. For a page with a different layout, render a different root fragment.
