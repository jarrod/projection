# mcp-projection: notes for coding agents

Add a live, styled UI for humans to an existing MCP server. The UI shows up in MCP Apps hosts (Claude, ChatGPT, VS Code) and, optionally, on a normal URL. Agent-facing tools, schemas and results stay unchanged.

## How it works
- **UI = f(user, params).** One `view` function on the server returns HTML. Nothing renders in the browser.
- **Actions = your existing tools.** `tool: "add_note"` makes the same `tools/call` the agent makes: same validation, same handler, same errors.
- **Live by default.** After every tool call (agent or human) open UIs render again and receive the HTML only if it changed. Nothing to declare.
- **View state = params.** What a viewer is looking at (search text, open row, page) is a small object kept in their browser and sent with each render. The server keeps no per-viewer state.

## Add it to a server (2 steps)
```ts
// src/ui.ts  ← keep ALL UI code in this one file
import { defineUi, html, Header, Button, Input, Table } from "mcp-projection";
import { store } from "./store.js";

export const ui = defineUi({
  name: "notes",
  attachTo: ["list_notes"],                               // tools whose results open the UI in hosts
  view: ({ user, params }) => {
    const notes = store.list(user).filter((n) => n.title.includes(params.q ?? ""));
    return html`
      ${Header({ title: "Notes" })}
      ${Input({ name: "q", set: true, debounce: 150, placeholder: "Search" })}
      ${Table({ id: "notes", rows: notes, rowKey: (n) => n.id,
        columns: [{ label: "Title", key: "title" }, { label: "", cell: (n) => Button({ size: "sm", tool: "pin_note", args: { id: n.id } }, "Pin") }] })}`;
  },
});
```
```ts
// src/server.ts: the only change to existing code
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));  // BEFORE registering tools
```

## Rules
1. Call `ui.attach(server)` **before** registering tools on it (it throws otherwise). Once per server instance is fine (e.g. one server per session).
2. If data changes outside a tool call (cron, webhook, queue), call `ui.write()`.
3. Put an `id` on anything that repeats (`Table` takes `id` + `rowKey`). Ids let the morph update rows in place and highlight only what changed.
4. Escape by default: `html\`` escapes every `${value}`. Use `raw()` only for trusted HTML.
5. No client JavaScript. For interaction use `tool` (server data), `set` (view params), popovers (`Dialog`, `Menu`), `Tabs` (radio + CSS), native inputs.
6. Split a big view into plain functions that return `html`. There is nothing to register.

## View params
- `Button({ set: { note: n.id } }, "Open")` merges `{ note }` into the viewer's params and renders again. Read it as `params.note`.
- `Input({ name: "q", set: true, debounce: 150 })` sets `params.q` while typing. `Select` and `Form` work the same way.
- Use params for anything only this viewer should see change: selection, search, sort, page, which screen. Use a tool for anything the agent should see.
- Params reset when the UI is reopened. Treat them as untrusted input.

## Who is viewing
`user` is the MCP user: `authInfo.extra.sub`, then `authInfo.clientId`, then `"local"`. Override with `identify`. There is no sign-in of its own, in hosts or on the web.

## Components (server-only, return Html)
Layout: `Stack Row Grid Separator Header Card`
Controls: `Button Form Input Textarea Select Checkbox` (pass `tool` + `args`, or `set`; `close`)
Display: `Badge Dot Stat Table Empty Skeleton Kbd Muted Mono Icon`
Overlays: `Dialog` + `Button({ opens: id })` + `Close(id)`, `Menu({ id, items })`, `Tabs({ id, tabs })`
Theme: `ThemeToggle()` (system / light / dark, pure CSS, hidden in hosts that set a theme)
Tones: `neutral ok warn bad info`. Icons: `plus check x more chevron down search trash pin external refresh sun moon monitor`.

## Attributes the runtime understands
| attr | meaning |
|---|---|
| `hx-tool="name"` | call tool on click / submit / change |
| `p-set` | instead of a tool: merge the values into the view params |
| `hx-vals='{"id":1}'` | extra args / params (JSON) |
| `hx-trigger="input"` + `p-debounce="300"` | act while typing |
| `p-close` | close surrounding popover after success |
| `p-keep` | never morph this element |
| `p-keep-values` | don't reset the form after success |
States set by the runtime: `aria-busy` while calling, `p-error="msg"` on failure, `p-updated` on changed rows.
What the user typed, ticked or selected survives updates unless the server changes that field's value.

## Web mode (optional): same UI on a URL
```ts
defineUi({ ..., web: { origin: "https://app.example.com", tool: "open_notes_in_browser" } });
http.createServer((req, res) => ui.site!.node(req, res)).listen(3000);   // or: ui.site.fetch(request)
```
- The browser session is delegated from an MCP request: it acts as that MCP user, its tool calls carry the same `authInfo` and run on the same server, and it ends when that auth expires. Users never sign in.
- Access only through single-use links: the opt-in agent tool, or `ui.openInBrowser(extra, { server })` / `ui.link(extra)` inside a tool handler. The tool uses MCP URL elicitation, so the link goes to the host, not into the model's context. Without elicitation support it falls back to returning the link as text.
- GET on a link shows a Continue page; POST redeems it, then sets an HttpOnly, SameSite=Lax, path-scoped cookie. Tokens are stored hashed.
- `ui.site.revoke(user)` ends a user's links and sessions.
- `site.node` compresses responses (brotli, else gzip). With `site.fetch`, compression is left to the platform or CDN.
- Tool handlers called from the web get `extra.authInfo` but cannot send notifications or requests (elicitation, sampling) to a client.

## Testing (no browser)
```ts
import { testUi } from "mcp-projection/testing";
const t = await testUi(createServer);
const view = await t.mount();
await t.agent.callTool({ name: "add_note", arguments: { title: "x", body: "" } });
await view.until((text) => text.includes("x"));
await view.click("pin_note", { id: 1 });           // like a human click
await view.set({ q: "x" });                         // like a `set` control
t.modelTools                                         // what the model sees (app-only tools excluded)
```
Snapshot HTML: `await ui.render({ q: "x" }, "u1")`.

## Visual check
`npx mcp-projection preview dist/ui.js ['{"q":"x"}'] [--dark] > preview.html` gives a styled static page (no runtime). Screenshot it.

## Styling
- Two files, two cascade layers: `src/ui/tokens.css` holds every design token (`--p-bg --p-fg --p-line --p-ring --p-r --p-font ...`), and `src/ui/kit.css` styles the components using only those tokens.
- Token values are `light-dark(light, dark)` and fall back to the host's MCP Apps variables (`--color-background-primary`, `--font-sans` ...), so the UI matches the host.
- Your `defineUi({ css })` is unlayered, so it always wins, whatever the selector: `css: ":root { --p-r: 6px }"`.
- Themes: `css: themes.terminal` (black, monospace, square) or `themes.pop` (bright: violet accent, pastel pill tags, rounded, tinted stats). Tweak with `` css: themes.terminal + `:root { --p-bg: #050505 }` ``. To write one, copy `src/ui/themes/terminal.css`: a `@layer p.theme { ... }` block that sets tokens and may restyle components.
- Your own theme needs no layer: a plain `:root { --p-... }` block plus any component tweaks. Fixed colours stop the UI following the host's palette; the default tokens are the ones that follow it.
- Light and dark: the host's theme (`data-theme`) wins, then `ThemeToggle()`, then the OS. Keep your own colours as `light-dark()` pairs so both modes work.
- `bare: true` drops the tokens and the kit. `css: TOKENS + myKit` keeps the tokens and replaces the components.

## Not included (by design)
Client state stores, client routing, JSX, a build step, per-fragment updates, its own sign-in. The whole view renders on each change and only the HTML that differs reaches the DOM.
