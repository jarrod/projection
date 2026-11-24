# projection

**Add a live, styled UI for humans to any MCP server without bringing a web framework into it.**

`mcp-projection` is a small TypeScript library for agent-first products. Your MCP server already exposes tools for AI agents. Projection adds a second view of the same system, for the people working alongside those agents: a server-rendered interface that updates in real time and calls the same tools. Agent-facing code stays exactly as it is.

![Notes example](docs/screenshots/shot-light.png)

## Why

In an MCP-first product the interesting logic lives in the tools. Once a human UI is added the usual way (React, a router, client state, an API layer, a build pipeline), that UI quickly becomes most of the codebase, and it duplicates the tool layer it sits on.

Projection treats the UI as a **projection of server state**:

- **UI = f(data).** Fragments are server functions that read data and return HTML.
- **Actions = your existing tools.** A button calls the same handler the agent calls.
- **Live updates come from writes.** When data changes, only the fragments that read it re-render, and the HTML is pushed to every open screen.

## Goals

| Goal | How |
|---|---|
| **Don't touch the agent side** | Tool names, schemas and results are byte-for-byte unchanged (checked by a snapshot test). The UI's helper tools are marked app-only, so hosts hide them from the model. |
| **Minimal footprint in your server** | One `ui.ts` file plus `ui.attach(new McpServer(...))`. No other dependencies beyond the MCP SDK and zod. |
| **Small and fast** | About 2.4 KB gzipped of browser JS and 3.6 KB of CSS. Writes in the same tick merge into one render, loads are memoized, unchanged HTML isn't sent, and the DOM morphs in place. Size budgets are enforced by the build. |
| **Real time** | Agent and human changes reach every open UI, with focus, typing and open dialogs preserved. |
| **Styled by default** | A minimal, hairline, monochrome component kit that adopts the host's theme (light or dark) automatically. |
| **Built for coding agents** | Typed data keys, warnings that say how to fix mistakes, a test harness that needs no browser, a static preview CLI, and [AGENTS.md](./AGENTS.md). |

## Where the UI appears

1. **Inside MCP hosts (MCP Apps).** Claude, ChatGPT, VS Code and other hosts that support the MCP Apps extension fetch a `ui://` resource and show it in a sandboxed frame. All traffic goes over MCP.
2. **On a normal URL (optional).** The same fragments, served by your server. Access is only through **single-use links** the server mints. The agent can ask the host to open one for the human (MCP URL elicitation), so the link never enters the model's context.

## How it works

```
 Agent (model) ──tools/call──▶ ┌──────────────────────────────┐
                               │  Your MCP server (unchanged) │
 Human ─▶ Host app ─ui://────▶ │  + ui.attach()               │
          (iframe)   p_mount   │    fragments ── read() ──▶ data
                     p_sync ◀──│    writes   ──▶ re-render ─▶ patches
                     p_call ──▶│    (same tool handlers)      │
 Human ─▶ Browser ─/ui (SSE)─▶ │  + ui.site (optional)        │
                               └──────────────────────────────┘
```

- `ui.attach(server)` wraps `registerTool` so it can capture handlers. It registers the `ui://` resource and three app-only tools: `p_mount` (first render), `p_sync` (waits for updates) and `p_call` (runs one of your tools for the UI).
- Tools listed in `writes` refresh the UI after **any** call, whether from the agent or the human. Their results pass through untouched.
- The browser runtime holds no state, templates or router. It applies HTML patches and turns `hx-tool` clicks into tool calls.

## Quick start

### 1. Install

```bash
npm install github:jarrod/projection
```

The package builds itself on install (`prepare`). For a private repo, your git credentials need access. npm 11 may warn that the `prepare` script isn't covered by `allowScripts`; if `node_modules/mcp-projection/dist/index.js` exists, the build ran and the warning can be ignored.

### 2. Write `src/ui.ts`

```ts
import { defineUi, html, Header, Button, Table } from "mcp-projection";
import { store } from "./store.js";

export const ui = defineUi({
  name: "notes",
  load: { notes: () => store.list() },                  // data the UI can read (typed)
  writes: { add_note: ["notes"], pin_note: ["notes"] }, // tool → data it changes; also the UI's allow-list
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

### 3. Attach it, before registering tools

```ts
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
server.registerTool("add_note", /* ...exactly as before... */);
```

That's the whole integration for MCP hosts. Data changes from outside tools (cron jobs, webhooks) need one call: `ui.write("notes")`.

### 4. Optional: web mode

```ts
defineUi({ /* ... */ web: { origin: "https://app.example.com", tool: "open_notes_in_browser" } });

http.createServer((req, res) => ui.site!.node(req, res)).listen(3000); // or ui.site.fetch(request)
```

`tool` adds **one** model-visible tool that sends the human a single-use link. Opening the link shows a Continue page (so link previews can't use it up), then exchanges it for an HttpOnly, SameSite=Lax cookie. Tokens are stored hashed and expire after 2 minutes; sessions last an hour. `ui.site.revoke(user)` ends them.

## Components

Components are server-only functions that return escaped HTML. Interactivity comes from native browser features (popover API, `<dialog>`-style popovers, radio-based tabs), so they add no client JavaScript.

- **Layout:** `Stack` `Row` `Grid` `Separator` `Header` `Card`
- **Controls:** `Button` `Form` `Input` `Textarea` `Select` `Checkbox` (each takes `tool`, `args`, `close`)
- **Display:** `Badge` `Dot` `Stat` `Table` `Empty` `Skeleton` `Kbd` `Muted` `Mono` `Icon`
- **Overlays:** `Dialog` + `Button({ opens })` + `Close`, `Menu`, `Tabs`

Design tokens (`--p-bg`, `--p-fg`, `--p-line` and so on) fall back to the host's MCP Apps variables (`--color-background-primary`, `--font-sans` ...). Add your own CSS with `defineUi({ css })`, or drop the kit with `bare: true`. Full API and attributes: [AGENTS.md](./AGENTS.md).

## Read-only UIs

`defineUi({ readOnly: true })` registers no `p_call` and ships a smaller runtime (1.6–1.8 KB gzipped). Tool calls from the agent still refresh the screen live.

## Testing your UI

```ts
import { testUi } from "mcp-projection/testing";

const t = await testUi(createServer);
const view = await t.mount();
await t.agent.callTool({ name: "add_note", arguments: { title: "x", body: "" } });
await view.until((text) => text.includes("x"));   // UI updated live
await view.click("pin_note", { id: 1 });           // act as the human
```

For a visual check: `npx mcp-projection preview dist/ui.js [fragment] [--dark] > preview.html` renders a styled static page.

## Guide and agent skill

- **[docs/guide.md](docs/guide.md)** is the detailed guide: how projection works, how to design a UI from a tool list, every component and option, actions, live updates, web mode, testing, and the pitfalls to avoid.
- **[skills/mcp-projection](skills/mcp-projection/SKILL.md)** is an agent skill (a folder with a `SKILL.md` that Claude Code and other coding agents load) that lets a coding agent do the whole integration: check fit, install, design the UI, write `ui.ts`, attach it, test, preview, and prove the agent's tools didn't change (`scripts/tool-snapshot.mjs`).

Install the skill for Claude Code by copying the folder into `~/.claude/skills/` (all projects) or `.claude/skills/` in your server's repo:

```bash
git clone --depth 1 https://github.com/jarrod/projection /tmp/projection && cp -r /tmp/projection/skills/mcp-projection ~/.claude/skills/
```

The npm package ships both, so after installing you can also copy `node_modules/mcp-projection/skills/mcp-projection`. Then ask the agent to "add a projection UI to this MCP server".

## Sizes

Minified and gzipped. The build fails if any of these exceed their budget.

| Part | Size | Budget |
|---|---|---|
| Browser runtime, MCP host | 2.4 KB | 2.8 KB |
| Browser runtime, web | 2.2 KB | 2.8 KB |
| Browser runtime, read-only | 1.6–1.8 KB | 2.0 KB |
| CSS kit | 3.6 KB | 4.0 KB |
| Server library (never sent to browsers) | 8.3 KB | 9.0 KB |

## Repository layout

```
src/                 library: engine, MCP attach (ui.ts), web mode, html helpers
src/client/          browser runtime (morph, MCP bridge, web transport), bundled at build
src/ui/              components + CSS kit
bin/                 preview CLI
examples/notes-server/  an agent-first MCP server with the UI added
tests/               unit, MCP-host (official ext-apps AppBridge) and real-Chrome suites
docs/guide.md        detailed guide to writing UIs for MCP servers
skills/mcp-projection/  agent skill: install, design, integrate, verify
AGENTS.md            API and rules for coding agents
CLAUDE.md            orientation for Claude Code
```

## Developing

```bash
npm install          # also builds
npm test             # build, example, unit + MCP-host suites
npm run test:web     # real Chrome via Python Playwright (pip install playwright; CHROME_PATH or playwright install chromium)
```

## Status

Version 0.2, a working prototype. All three test suites pass, including the official ext-apps host bridge and real Chrome.

Not yet proven or built:
- Running inside a production host (Claude, ChatGPT, VS Code).
- More than one server process. State is held in memory, so scaling out needs a shared change feed (for example Redis or Postgres LISTEN/NOTIFY).
- Web mode trusts the user identity your MCP server already has (`authInfo`). Production use needs real MCP authentication upstream.
