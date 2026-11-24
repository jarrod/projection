---
name: mcp-projection
description: Install mcp-projection and add a basic MCP Apps UI to an existing Node.js MCP server. Use when asked to set up Projection, or to add a UI, dashboard, admin panel or live view to an MCP server's existing tools, or when the code mentions defineUi or ui.attach.
---

# Set up a basic Projection UI

`<skill-dir>` means the folder that contains this file.

## 1. Find the server and choose the UI mode

Check for a long-lived Node 20+ ESM server using `McpServer` from `@modelcontextprotocol/sdk` ^1.20.0 and Zod ^3.25.0 or ^4.0.0. Find where it creates the server, registers tools, and reads the data the UI should show. If the server is incompatible, explain the mismatch before changing it.

List the tools from the existing registrations, or use `tools/list` if the server is already connected. Show the caller each tool's name, what it does, and whether it reads, writes, or needs review. Inspect the handler to confirm uncertain behavior without running it.

- **Read-only** shows data through the existing store and lets viewers interact with view-only controls such as filters. An existing read tool opens the UI. The view offers no tool-backed actions.
- **Full MCP** shows the same data and adds controls for the existing tool actions the caller selects. Choose an opening tool, usually a list or status tool, and the actions separately.

If any choices are missing, present the list and ask for the missing choices in one prompt. For example, `Read-only · open: list_notes` or `Full MCP · open: list_notes · actions: pin_note`. If the caller delegates the choice, start read-only with the clearest list or status tool. These modes control what the UI offers. The server continues to authorize its tools as before.

Before changing anything, build the server and record what the model sees. Run this from the server's project folder, with its start command after `--`:

```bash
node <skill-dir>/scripts/tool-snapshot.mjs --out /tmp/projection-before.json -- node dist/index.js
```

For a server that only speaks HTTP, start it and pass `--url http://localhost:3000/mcp` instead of `-- <command>`.

## 2. Install Projection

Use the target project's package manager and keep its existing Projection dependency if present. For npm:

```bash
npm install github:jarrod/projection
```

If the Git install leaves the package without built exports, check out the same source revision in a temporary directory and run `npm ci` and `npm pack` there. Install the tarball printed by `npm pack` from the target project.

## 3. Add and attach the view

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

In Full MCP mode, add controls for the selected actions and match each tool's existing schema. For a row action, import `Button` and add a column:

```ts
{ label: "", cell: (note) => Button({ size: "sm", tool: "pin_note", args: { id: note.id } }, "Pin") }
```

Form fields, inputs and selects send text, and checkboxes send booleans. Values in `args` keep their JSON type, so pass ids and other numbers there: a `z.number()` schema rejects a string, and the schema must not change. Keep existing tools, schemas, and handlers intact. See the [component reference](references/reference.md#components) if you need a different control.

Import the UI where the server is created. Wrap the existing constructor call once per instance, before any tools are registered.

```ts
import { ui } from "./ui.js";

const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
```

Every tool call refreshes the UI. If data also changes outside tools (a cron job, webhook or worker), call `ui.write()` where it changes.

## 4. Check the setup

Run the project's usual build or type check. Then compare what the model sees with the snapshot from step 1:

```bash
node <skill-dir>/scripts/tool-snapshot.mjs --compare /tmp/projection-before.json -- node dist/index.js
```

It must print `OK`. If an existing tool changed, undo the edit that changed it. If a test MCP Apps host is available, call the opening tool and check the expected data and controls. For errors or a UI that doesn't update, see [troubleshooting](references/troubleshooting.md).

Tell the caller which tool opens the UI and which actions are available.
