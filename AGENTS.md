# mcp-projection: notes for coding agents

Add a live, styled UI for humans to an existing MCP server. A person opens it in their browser through a single-use link the agent sends (web mode, on by default). It is also offered to apps that support MCP Apps, which is untested. Agent-facing tools, schemas and results stay unchanged.

## How it works
- **UI = f(user, params).** One `view` function on the server returns HTML. Nothing renders in the browser.
- **Actions = your existing tools.** `tool: "add_note"` makes the same `tools/call` the agent makes: same validation, same handler, same errors.
- **Live by default.** After every tool call (agent or human) open UIs render again and receive the HTML only if it changed. Nothing to declare. Calls to tools annotated `readOnlyHint: true` are skipped, since they change nothing.
- **View state = params.** What a viewer is looking at (search text, open row, page) is a small object kept in their browser and sent with each render. The server keeps no per-viewer state.

## Add it to a server (2 steps)
```ts
// src/ui.ts  ← keep ALL UI code in this one file
import { defineUi, html, Header, Button, Input, Table } from "mcp-projection";
import { store } from "./store.js";

export const ui = defineUi({
  name: "notes",
  attachTo: ["list_notes"],                               // for apps that support MCP Apps (untested)
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
4. Escape by default: `html\`` escapes every `${value}`. Use `raw()` only for trusted HTML; a hand-built `{ __html }` object is escaped like any other value. The view itself must return `html\`...\``: anything else throws.
5. No client JavaScript. For interaction use `tool` (server data), `set` (view params), popovers (`Dialog`, `Menu`), `Tabs` (radio + CSS), native inputs.
6. Split a big view into plain functions that return `html`. There is nothing to register.

## View params
- `Button({ set: { note: n.id } }, "Open")` merges `{ note }` into the viewer's params and renders again. Read it as `params.note`.
- `Input({ name: "q", set: true, debounce: 150 })` sets `params.q` while typing. `Select` and `Form` work the same way.
- Use params for anything only this viewer should see change: selection, search, sort, page, which screen. Use a tool for anything the agent should see.
- Params reset when the UI is reopened. Treat them as untrusted input: any value can be any JSON type, so read them as `String(params.q ?? "")`.

## Who is viewing
`user` is the MCP user: `authInfo.extra.sub`, or `"local"` when the request carries no auth (stdio). There is no sign-in of its own, in hosts or on the web.
- An authenticated request with no `extra.sub` throws. A client id names the agent app, not the person, so it is never used as the user. Set `extra.sub` in your token verifier, or pass `identify`. An `identify` that returns nothing throws too.
- `ui.identify(extra)` gives the same id inside a tool handler, so tools and view scope data to the same user: `store.list(ui.identify(extra))`.

## Components (server-only, return Html)
Layout: `Stack Row Grid Separator Header Card`
Controls: `Button Form Input Textarea Select Checkbox` (pass `tool` + `args`, or `set`; `close`)
Display: `Badge Dot Stat Table Empty Skeleton Kbd Muted Mono Icon`
Overlays: `Dialog` + `Button({ opens: id })` + `Close(id)`, `Menu({ id, items })`, `Tabs({ id, tabs })` (up to 6 tabs). A `Button` can take `opens` together with `tool` or `set` (open the dialog for this row). A `Menu` item's `href` must be http(s), mailto or relative.
Theme: `ThemeToggle()` (system / light / dark, pure CSS, hidden in hosts that set a theme)
Tones: `neutral ok warn bad info`. Icons: `plus check x more chevron down search trash pin external refresh sun moon monitor`.

## Web mode (on by default): same UI on a URL
- Every UI adds one model-visible tool, `open_<name>_in_browser`, that sends the person a single-use link. No sign-in: the link delegates the MCP user to a browser session. `ui.openInBrowser(extra, { server })` does the same from your own handler.
- Local servers need nothing: without `origin`, projection serves the UI on 127.0.0.1 at a free port.
- Hosted servers give the public origin and route requests to the UI:
```ts
defineUi({ ..., web: { origin: "https://app.example.com" } });
http.createServer((req, res) => ui.site!.node(req, res)).listen(3000);   // or: ui.site!.fetch(request)
```
- `web: { tool: false }` keeps web mode without the tool; `web: false` turns it off.
- The link is a pre-authenticated URL, which the MCP elicitation spec says servers must not send. This is deliberate; `docs/web-mode.md` says what bounds it.
- Call `ui.site!.revoke(user)` when the user signs out or their MCP session ends.

## Deploying
- One long-lived Node process. Viewers wait on a counter in memory, and web links and sessions are kept in memory: with several instances use sticky routing, and expect a restart to end browser sessions. Serverless and edge runtimes are not supported.
- A change on one instance reaches viewers on another only when their poll times out (up to 25 s).
- Every write renders the view once per distinct (user, params) being watched. Keep views small: page large tables (about 200 rows).
- ESM only. Supported Node and SDK versions are in `package.json` (`engines`, `peerDependencies`).

## Unreleased
- Web mode is on by default. Every UI adds `open_<name>_in_browser` (rename with `web.tool`, drop with `tool: false`, turn web mode off with `web: false`). Without `origin`, the UI is served on 127.0.0.1 at a free port.

## Changed in 0.3
- `ui.link(extra, server)` and `ui.openInBrowser(extra, { server })` need the attached server.
- An authenticated request must carry `authInfo.extra.sub` (or pass `identify`); the client id is no longer used as the user.
- A view must return `html\`...\``.
- `Menu` no longer sets `role="menu"`: it is a plain list of buttons and links, reached with Tab.

## Where to look
| Need | File |
|---|---|
| Every component, prop and option | The types: `src/ui/components.ts`, `src/ui.ts`, `src/web.ts` |
| Patterns | `skills/mcp-projection/references/recipes.md` |
| Symptom → fix | `skills/mcp-projection/references/troubleshooting.md` |
| Web mode in full | `docs/web-mode.md` |
| The whole integration, as an agent skill | `skills/mcp-projection/SKILL.md` |

## Not included (by design)
Client state stores, client routing, JSX, a build step, per-fragment updates, its own sign-in. The whole view renders on each change and only the HTML that differs reaches the DOM.
