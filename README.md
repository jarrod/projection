# projector

A live UI for the people working alongside your agents. Add it to any MCP server without changing its tools.

```ts
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
```

- **Same tools.** Nothing the agent sees changes, except one added tool: `open_<name>_in_browser`.
- **Only through tools.** The UI reads and acts by calling your tools, as the signed-in person. It has no other way to your data.
- **Live.** Every tool call updates every open view.
- **No sign-in.** The agent hands over a single-use link.
- **Small.** About 2.5 KB of JavaScript, no new dependencies.

## Install

```bash
pnpm add github:jarrod/projector#v0.4.0
```

Each `v*` tag has `dist/` built in. The docs below ship in the package too, under `node_modules/mcp-projector/`.

## Docs

[Getting started](docs/getting-started.md) · [Building a UI](docs/building-a-ui.md) · [How it works](docs/how-it-works.md) · [Web mode](docs/web-mode.md) · [AGENTS.md](AGENTS.md) · [Example](https://github.com/jarrod/projector/blob/main/examples/notes-server/src/ui.ts)

Using Claude Code or Codex? [Install the skill](docs/getting-started.md#have-an-agent-do-it) and ask your agent to add it.

## Develop

```bash
corepack enable
pnpm install && pnpm test
```
