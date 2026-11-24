# Getting started

Add a live UI to an existing MCP server. You write one file and change one line. To have an agent do it, give it the skill in [`skills/mcp-projection`](../skills/mcp-projection/SKILL.md).

![The notes example](screenshots/shot-light.png)

## Does it fit?

You need a long-lived Node server built on `McpServer` from the MCP TypeScript SDK, with zod. A low-level `Server`, serverless runtimes and other languages won't work. Supported versions are in `package.json`, and your package manager reports a mismatch when you install.

## 1. Install

```bash
npm install github:jarrod/projection
```

## 2. Write `src/ui.ts`

```ts
import { defineUi, html, Header, Table, Button } from "mcp-projection";
import { store } from "./store.js";

export const ui = defineUi({
  name: "notes",
  attachTo: ["list_notes"],     // the UI opens when the agent calls this tool
  view: ({ user }) => html`
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

The view reads your store directly and returns HTML. The button calls `pin_note`, the same tool the agent calls.

## 3. Attach it

Wrap the server where you create it, before any tool is registered:

```ts
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
```

That's the whole integration. Your tools, schemas and results don't change.

## 4. See it

In an MCP Apps host (Claude, ChatGPT, VS Code), ask the agent to list your notes. Or render a static page:

```bash
npx mcp-projection preview dist/ui.js > preview.html
```

## 5. Test it

`testUi` runs your server as an agent and as a host, with no browser. It needs a `createServer()` factory that builds and returns the server.

```js
import { testUi } from "mcp-projection/testing";
import { createServer } from "./dist/server.js";

const t = await testUi(createServer);
const view = await t.mount();
await t.agent.callTool({ name: "add_note", arguments: { title: "Hello" } });
await view.until((text) => text.includes("Hello"));   // the agent's change shows up
await view.click("pin_note", { id: 1 });               // a person's click works
view.close(); await t.close(); process.exit();          // exit: a pending poll can hold Node open
```

## Next

- A fuller example: [`examples/notes-server`](../examples/notes-server/src/ui.ts) has search, tabs, a dialog form, a row action and web mode.
- [Building a UI](building-a-ui.md) covers params, actions, styling and the mistakes people make.
- [How it works](how-it-works.md) explains what happens on each update.
- Every component and option is typed and documented in the package's types: start at [`components.ts`](../src/ui/components.ts).
