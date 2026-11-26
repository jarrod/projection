# Getting started

Add a live UI to an existing MCP server. You write one file and change one line. Your tools stay as they are: the UI reads and writes only through them. To have an agent do it, [install the skill](#have-an-agent-do-it).

![The notes example](screenshots/shot-light.png)

## Does it fit?

You need a server built on `McpServer` from the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), with zod 4. It can be a long-running Node server or run on a serverless host such as Cloudflare Workers ([deploying](web-mode.md#deploying)). A low-level `Server` and other languages won't work.

The UI can only show what your tools return, so you need at least one tool that reads what people want to see. Supported versions are in `package.json`, and your package manager reports a mismatch when you install.

## 1. Install

```bash
npm install github:jarrod/projector
```

## 2. Write `src/ui.ts`

```ts
import { defineUi, html, Header, Table, Button } from "mcp-projector";

export const ui = defineUi({
  name: "notes",
  attachTo: ["list_notes"],     // for apps that support MCP Apps (untested)
  view: async ({ call }) => {
    const { structuredContent } = await call("list_notes");   // your tool, as the viewer
    return html`
      ${Header({ title: "Notes" })}
      ${Table({
        id: "notes", rows: structuredContent?.notes ?? [], rowKey: (n) => n.id,
        columns: [
          { label: "Title", key: "title" },
          { label: "", cell: (n) => Button({ size: "sm", tool: "pin_note", args: { id: n.id } }, "Pin") },
        ],
      })}`;
  },
});
```

The view gets its data by calling `list_notes`, and the button calls `pin_note`: the same tools the agent calls, through the same handler, as the person viewing.

This assumes `list_notes` returns `structuredContent` and is annotated `readOnlyHint: true`. If it returns only text, read the text: the [example](../examples/notes-server/src/ui.ts) does. If it isn't annotated, list it in `reads: ["list_notes"]` rather than editing the tool. A view can only call read tools, so rendering never changes data.

## 3. Attach it

Wrap the server where you create it, before any tool is registered:

```ts
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
```

That's the whole integration. Your tools, schemas and results don't change, and nothing else in the server needs editing; projector adds one tool, `open_notes_in_browser`.

## 4. See it

Ask your agent to show you the notes UI. It calls `open_notes_in_browser`, and you get a single-use link that opens the UI in your browser.

A server people reach over the network needs two more settings: see [Web mode](web-mode.md#hosted-servers-give-the-origin-and-a-secret).

To look at it without an agent, render a static page:

```bash
npx mcp-projector preview dist/ui.js > preview.html
```

## 5. Test it

`testUi` runs your server as an agent and as a host, with no browser. It needs a `createServer()` factory that builds and returns the server.

```js
import { testUi } from "mcp-projector/testing";
import { createServer } from "./dist/server.js";

const t = await testUi(createServer);
const view = await t.mount();
await t.agent.callTool({ name: "add_note", arguments: { title: "Hello", body: "" } });
await view.until((text) => text.includes("Hello"));   // the agent's change shows up
await view.click("pin_note", { id: 1 });               // a person's click works
view.close(); await t.close();
```

## Have an agent do it

The [`mcp-projector` skill](../skills/mcp-projector/SKILL.md) walks an agent through all of the steps above.

**Claude Code:** install it as a plugin, then ask Claude to add Projector to your server.

```
/plugin marketplace add jarrod/projector
/plugin install mcp-projector@projector
```

**Codex:** add the marketplace, then install `mcp-projector` from the plugin list.

```bash
codex plugin marketplace add jarrod/projector
```

**Any agent, after `npm install`:** copy the skill into the folder your agent reads skills from. Claude Code reads `.claude/skills/`, and Codex reads `.agents/skills/`.

```bash
mkdir -p .claude/skills && cp -r node_modules/mcp-projector/skills/mcp-projector .claude/skills/
```

```bash
mkdir -p .agents/skills && cp -r node_modules/mcp-projector/skills/mcp-projector .agents/skills/
```

## Next

- A fuller example: [`examples/notes-server`](../examples/notes-server/src/ui.ts) has search, tabs, a dialog form, a row action and web mode.
- [Building a UI](building-a-ui.md) covers params, actions, styling and the mistakes people make.
- [How it works](how-it-works.md) explains what happens on each update.
- Every component and option is typed and documented in the package's types: start at [`components.ts`](../src/ui/components.ts).
