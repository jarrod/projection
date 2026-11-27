<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg">
  <img alt="projector: your agent does the work, projector puts it on screen" src="docs/banner-light.svg">
</picture>

This page is for AI agents. `mcp-projector` adds a live web UI to an MCP server. The UI shows data from the server's tools. Each button in the UI calls one of the server's tools. The user and the server's agent see the same data.

> **Are you a person?** Give your coding agent this prompt:
>
> ```text
> Install mcp-projector: pnpm add github:jarrod/projector#latest
> Then follow node_modules/mcp-projector/skills/mcp-projector/SKILL.md to attach it to this MCP server and build a view.
> ```
>
> Claude Code and Codex can also [install the skill as a plugin](docs/getting-started.md#have-an-agent-do-it).

## What the user gets

- The server's agent gets one new tool: `open_<name>_in_browser`. This tool sends a single-use link to the user.
- All other tools, schemas and results stay the same.
- The UI reads data only through read tools. It changes data only through tool calls.
- Each browser request uses the agent's auth. Projector adds no sign-in and no state.
- Open pages check for changes every 5 seconds.
- Themes: light and dark, `terminal`, `pop`, or custom CSS.
- About 2.5 KB of browser JavaScript. You write no client code.

## Requirements

Check these before you install. If the server does not meet them, stop and tell the user.

- Node.js 22.18 or later.
- A server that uses `McpServer` from `@modelcontextprotocol/server` 2.4 or later. The v1 SDK (`@modelcontextprotocol/sdk`) does not work. A low-level `Server` does not work.
- zod 4.2 or later.
- One or more tools that return the data to show.

## Your steps

Do these steps when the user asks for a UI, dashboard or live view of an MCP server:

1. Check the requirements above.
2. Install the latest release with the project's package manager: `pnpm add github:jarrod/projector#latest` or `npm install github:jarrod/projector#latest`. Do not write a version number.
3. Read `node_modules/mcp-projector/skills/mcp-projector/SKILL.md` and follow it. It tells you what to ask the user.
4. Obey the rules below and in `node_modules/mcp-projector/AGENTS.md`. These files match the installed version. They win over this page.
5. Tell the user to restart the server. Then the user asks the server's agent to show the UI. That agent calls `open_<name>_in_browser` and sends a link.

## What you will write

You write one new file and change one line. This example is for a server with the tools `list_todos` and `complete_todo`.

`src/ui.ts`:

```ts
import { defineUi, html, Header, Table, Button } from "mcp-projector";

export const ui = defineUi({
  name: "todos",
  view: async ({ call }) => {
    const { structuredContent } = await call("list_todos");
    const todos: { id: number; title: string }[] = structuredContent.todos;
    return html`
      ${Header({ title: "Todos" })}
      ${Table({
        id: "todos", rows: todos, rowKey: (t) => t.id,
        columns: [
          { label: "Todo", key: "title" },
          { label: "", cell: (t) => Button({ tool: "complete_todo", args: { id: t.id } }, "Done") },
        ],
      })}`;
  },
});
```

In the file that makes the server, wrap the `McpServer`. Do this before you register a tool:

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { ui } from "./ui.js";

const server = ui.attach(new McpServer({ name: "todos", version: "1.0.0" }));
```

`list_todos` must have `annotations: { readOnlyHint: true }`. If it does not, add `reads: ["list_todos"]` to `defineUi`. Do not change the tool.

## Rules

- Call `ui.attach()` before you register a tool. If you do not, it throws an error.
- Do not change the server's tools for the UI. If no tool returns the data, stop and tell the user.
- Do not import the server's store or database into the UI. Use `call`.
- `call` runs only read tools.
- Give each `Table` an `id` and a `rowKey`. If you do not, rows lose focus when the data changes.
- Install a release: `#latest` or `#v<version>`. Do not install a branch. Branches have no `dist/`.
- For a hosted server, read [Web mode](docs/web-mode.md). Without `web.origin`, links work only on the same machine.

## Where to look

All paths are in `node_modules/mcp-projector/`. Each file matches the installed version.

| Task | File |
|---|---|
| Integrate, step by step | [`skills/mcp-projector/SKILL.md`](skills/mcp-projector/SKILL.md) |
| Rules for agents | [`AGENTS.md`](AGENTS.md) |
| Walkthrough and tests | [`docs/getting-started.md`](docs/getting-started.md) |
| Components and styles | [`docs/building-a-ui.md`](docs/building-a-ui.md), then `dist/ui/components.d.ts` |
| Patterns: queues, filters, paging | [`skills/mcp-projector/references/recipes.md`](skills/mcp-projector/references/recipes.md) |
| Errors and fixes | [`skills/mcp-projector/references/troubleshooting.md`](skills/mcp-projector/references/troubleshooting.md) |
| Links, auth and hosting | [`docs/web-mode.md`](docs/web-mode.md) |
| Changes between versions | [`CHANGELOG.md`](CHANGELOG.md) |

To change projector itself: `corepack enable && pnpm install && pnpm test`. License: [MIT](LICENSE).
