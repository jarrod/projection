<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg">
  <img alt="projector: your agent does the work, projector puts it on screen" src="docs/banner-light.svg">
</picture>

Add a live, styled UI to any MCP server, built from the tools it already has. People see what the agent sees and press the same buttons it calls. There's no frontend to build and no tools to change.

- **Your tools, untouched.** The agent gets one new tool, `open_<name>_in_browser`. Everything else stays exactly as it was.
- **Tools are the only way in.** The page reads by calling your read tools and acts by calling the rest, with the agent's own auth. It never goes around them to your data.
- **Live.** Changes from the agent or from people show up on every open page within seconds.
- **Themed.** Looks good out of the box in light and dark, with `terminal` and `pop` themes if you want more attitude. Or bring your own: a `css` string beats the built-in styles.
- **No sign-in.** The agent hands over a single-use link.
- **Tiny.** About 2.5 KB of browser JavaScript. No React, no bundler, no new dependencies.

## Let your agent do it

Paste this into Claude Code, Codex, Cursor or whatever you use:

```text
Install mcp-projector: pnpm add github:jarrod/projector#latest
Then follow node_modules/mcp-projector/skills/mcp-projector/SKILL.md to attach it to this MCP server and build a view.
```

## Or do it by hand

Install it:

```bash
pnpm add github:jarrod/projector#latest
```

Describe the page. The data comes from your tools, and the buttons call your tools:

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
        rows: todos,
        columns: [
          { label: "Todo", key: "title" },
          { label: "", cell: (t) => Button({ tool: "complete_todo", args: { id: t.id } }, "Done") },
        ],
      })}`;
  },
});
```

Attach it where you create the server. That's the whole integration:

```ts
const server = ui.attach(new McpServer({ name: "todos", version: "1.0.0" }));
```

Now ask your agent to show you your todos. It sends you a link. Press Done, and the agent sees it the next time it looks.

## More

[Getting started](docs/getting-started.md) · [Building a UI](docs/building-a-ui.md) · [How it works](docs/how-it-works.md) · [Web mode](docs/web-mode.md) · [Example](https://github.com/jarrod/projector/blob/main/examples/notes-server/src/ui.ts) · [AGENTS.md](AGENTS.md)

Claude Code and Codex can also [install the skill as a plugin](docs/getting-started.md#have-an-agent-do-it), so it's there whenever you ask for a UI.

Hacking on projector itself: `corepack enable && pnpm install && pnpm test`. [MIT licensed](LICENSE).
