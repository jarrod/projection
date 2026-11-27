---
name: mcp-projector
description: Add mcp-projector to an existing Node.js MCP server, so people can open a live view of it in their browser and use its tools from there. Use when asked to set up Projector, or to add a UI, dashboard, admin panel or live view to an MCP server's existing tools, or when the code mentions defineUi or ui.attach.
---

# Set up a basic Projector UI

## 1. Find the server and its tools

Projector runs inside a long-lived Node server built on `McpServer` from the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). SDK v1 (`@modelcontextprotocol/sdk`) is not supported: say so, since moving the server to v2 is a change to its code. A low-level `Server` or another language won't work; say so before changing anything. Supported versions are in Projector's `package.json` (`engines` and `peerDependencies`), and the package manager reports a mismatch when you install.

Find where the server is created and where tools are registered. List each tool with what it does, whether it only reads or changes data, whether it is annotated `readOnlyHint`, and what it returns (`structuredContent`, or text only). Read the handler when that isn't clear; don't run it.

The UI reads and acts only through these tools. Don't change them, don't add tools, and don't import the server's store, database or API client into the UI. If no tool returns what the caller wants to see, tell them so and stop there.

## 2. Decide what the UI does

Ask the caller one question, showing the tool list from step 1:

> Which tool should open the UI, and should people only watch, or also act? If they act, which tools get a button or form?

The UI can show only what read tools return.

For example: "Open on `list_notes`, watch only" or "Open on `list_notes`, with `pin_note` and `delete_note` as actions". Skip anything the request already answers. If the caller leaves it to you, choose. A watch-only UI on the clearest list or status tool is a good start. Search and filters need no tools, so any UI can have them.

## 3. Install Projector

Keep the target project's existing Projector dependency if present. Otherwise install the latest release with the project's package manager (each release is a `v*` tag with `dist/` built in, and `latest` points at the newest). For pnpm:

```bash
pnpm add github:jarrod/projector#latest
```

For npm: `npm install github:jarrod/projector#latest`. Don't write a version number: the `latest` tag always points at the newest release, and the lockfile records the exact commit.

Install a `v*` tag, never a branch: branches hold no `dist/`, so their imports fail.

This skill can be newer than the installed release. Where they differ, the installed package wins: its docs are in `node_modules/mcp-projector/` (`AGENTS.md`, `docs/`) and its API is the types in `node_modules/mcp-projector/dist/`.

## 4. Add and attach the view

Create `src/ui.ts` (or the matching JavaScript file). Adapt the tool names, title, fields and `attachTo` tool to the project. The view reads with `call(tool, args)`, which runs the server's own tool as the person viewing, so the tool scopes data as it already does.

`call` only runs read tools: annotated `readOnlyHint: true`, or listed in `reads`. Add a tool to `reads` only if it changes nothing. Leave the server's annotations as they are.

```ts
import { defineUi, Empty, Header, html, Table } from "mcp-projector";

export const ui = defineUi({
  name: "notes",
  attachTo: ["list_notes"],
  reads: ["list_notes"], // only reads, but not annotated readOnlyHint
  view: async ({ call }) => {
    const r = await call("list_notes");
    const notes = r.isError ? [] : r.structuredContent?.notes ?? [];
    return html`
      ${Header({ title: "Notes" })}
      ${Table({
        id: "notes",
        rows: notes,
        rowKey: (note) => note.id,
        columns: [{ label: "Title", key: "title" }],
        empty: Empty({ title: "No notes yet" }),
      })}`;
  },
});
```

If the tool returns only text, parse `r.content[0].text` into rows, and show the text as it is if it doesn't parse. `examples/notes-server/src/ui.ts` in the Projector repository does this.

If the UI has actions, add a control for each chosen tool, matching its schema. For a row action, import `Button` and add a column:

```ts
{ label: "", cell: (note) => Button({ size: "sm", tool: "pin_note", args: { id: note.id } }, "Pin") }
```

Form fields, inputs and selects send text, and checkboxes send booleans. Values in `args` keep their JSON type, so pass ids and other numbers there: a `z.number()` schema rejects a string. For other controls and their props, read the documented types in `node_modules/mcp-projector/dist/ui/components.d.ts`, and see [recipes](references/recipes.md) for common patterns.

Import the UI where the server is created. Wrap the existing constructor call once per instance, before any tools are registered. This is the only change to existing server code.

```ts
import { ui } from "./ui.js";

const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
```

Open pages check for changes every 5 seconds and after their own actions, so changes from anywhere show up without any code in the server.

## 5. Check the setup

Run the project's usual build or type check. If a test MCP Apps host is available, call the opening tool and check the expected data and controls. For errors or a UI that doesn't update, see [troubleshooting](references/troubleshooting.md).

Tell the caller which actions are available, and that they can ask the agent to show the UI in their browser (`open_<name>_in_browser`). A server reached over the network needs `web: { origin, secret, mcp }` (`mcp` is its own MCP endpoint, so browser requests go through its auth) and its HTTP routed to `ui.site.node` or `ui.site.fetch`; on several instances or serverless also a `claim` backed by real storage (see `docs/web-mode.md` in the Projector repository). Don't add sign-in, sessions or state for the UI: the browser carries the agent's own auth. A local one needs nothing.
