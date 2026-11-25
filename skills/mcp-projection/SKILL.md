---
name: mcp-projection
description: Add mcp-projection to an existing Node.js MCP server, so people can open a live view of it in their browser and use its tools from there. Use when asked to set up Projection, or to add a UI, dashboard, admin panel or live view to an MCP server's existing tools, or when the code mentions defineUi or ui.attach.
---

# Set up a basic Projection UI

## 1. Find the server and its tools

Projection runs inside a long-lived Node server built on `McpServer` from the MCP TypeScript SDK. A low-level `Server` or another language won't work; say so before changing anything. Supported versions are in Projection's `package.json` (`engines` and `peerDependencies`), and the package manager reports a mismatch when you install.

Find where the server is created, where tools are registered, and the store or API the tools read. List each tool with what it does and whether it reads or changes data. Read the handler when that isn't clear; don't run it.

## 2. Decide what the UI does

Ask the caller one question, showing the tool list from step 1:

> Which tool should open the UI, and should people only watch, or also act? If they act, which tools get a button or form?

For example: "Open on `list_notes`, watch only" or "Open on `list_notes`, with `pin_note` and `delete_note` as actions". Skip anything the request already answers. If the caller leaves it to you, choose. A watch-only UI on the clearest list or status tool is a good start. Search and filters need no tools, so any UI can have them.

## 3. Install Projection

Use the target project's package manager and keep its existing Projection dependency if present. For npm:

```bash
npm install github:jarrod/projector
```

If the Git install leaves the package without built exports, check out the same source revision in a temporary directory and run `npm ci` and `npm pack` there. Install the tarball printed by `npm pack` from the target project.

## 4. Add and attach the view

Create `src/ui.ts` (or the matching JavaScript file). Adapt the store, title, fields, and `attachTo` tool to the project. Scope reads to the same user the existing tools use. Projection gets that ID from `authInfo.extra.sub` by default and uses `"local"` without auth. Use `identify` for a different existing identity mapping.

```ts
import { defineUi, Empty, Header, html, Table } from "mcp-projection";
import { store } from "./store.js";

export const ui = defineUi({
  name: "notes",
  attachTo: ["list_notes"],
  view: async ({ user }) => html`
    ${Header({ title: "Notes" })}
    ${Table({
      id: "notes",
      rows: await store.list(user),
      rowKey: (note) => note.id,
      columns: [{ label: "Title", key: "title" }],
      empty: Empty({ title: "No notes yet" }),
    })}`,
});
```

If the UI has actions, add a control for each chosen tool, matching its schema. For a row action, import `Button` and add a column:

```ts
{ label: "", cell: (note) => Button({ size: "sm", tool: "pin_note", args: { id: note.id } }, "Pin") }
```

Form fields, inputs and selects send text, and checkboxes send booleans. Values in `args` keep their JSON type, so pass ids and other numbers there: a `z.number()` schema rejects a string. For other controls and their props, read the documented types in `node_modules/mcp-projection/dist/ui/components.d.ts`, and see [recipes](references/recipes.md) for common patterns.

Import the UI where the server is created. Wrap the existing constructor call once per instance, before any tools are registered.

```ts
import { ui } from "./ui.js";

const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
```

Every tool call refreshes the UI. If data also changes outside tools (a cron job, webhook or worker), call `ui.write()` where it changes.

## 5. Check the setup

Run the project's usual build or type check. If a test MCP Apps host is available, call the opening tool and check the expected data and controls. For errors or a UI that doesn't update, see [troubleshooting](references/troubleshooting.md).

Tell the caller which actions are available, and that they can ask the agent to show the UI in their browser (`open_<name>_in_browser`). A server reached over the network needs `web: { origin }` and its HTTP routed to `ui.site.node`; a local one needs nothing.
