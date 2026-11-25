# mcp-projection

A live UI for the people working alongside your agents. Add it to any MCP server without changing its tools.

```ts
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
```

- **Same tools.** Nothing the agent sees changes, except one added tool: `open_<name>_in_browser`.
- **Live.** Every tool call updates every open view.
- **No sign-in.** The agent hands over a single-use link.
- **Small.** About 2.5 KB of JavaScript, no new dependencies.

## Docs

[Getting started](docs/getting-started.md) · [Building a UI](docs/building-a-ui.md) · [How it works](docs/how-it-works.md) · [Web mode](docs/web-mode.md) · [AGENTS.md](AGENTS.md) · [Example](examples/notes-server/src/ui.ts)

## Develop

```bash
npm install && npm test
```
