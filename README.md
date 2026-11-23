# mcp-projection

Add a live, styled UI for humans to any MCP server without bringing a web framework into it.

- **Agent side unchanged.** Tools, schemas and results are byte-for-byte the same. The UI's helper tools are hidden from the model.
- **One file and two changed lines.** Write `ui.ts`, then change `new McpServer(...)` to `ui.attach(new McpServer(...))`.
- **Live.** A change by the agent or the human re-renders only the fragments that read that data, and only the changed rows highlight.
- **Two places to show it.** Inside MCP Apps hosts (`ui://` resource) and, optionally, on a URL behind single-use links the agent hands to the human.
- **Small.** About 2.4 KB gzipped of browser JavaScript (1.6–1.8 KB read-only) plus 3.6 KB of CSS. No dependencies beyond the MCP SDK and zod your server already has.

![Notes example, light](docs/screenshots/shot-light.png)

```
npm install && npm test        # build, example server, unit + MCP-host tests
npm run test:web               # real Chrome (needs Python Playwright)
```

Start with [AGENTS.md](./AGENTS.md). See `examples/notes-server` and its git history for a minimal integration.
