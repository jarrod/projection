# projection

Library: `mcp-projection`. It adds a live, styled UI for humans to an MCP server without changing agent-facing tools.

- **Read `AGENTS.md` first.** It has the API, the rules and the components.
- Layout: library in `src/` (server engine, MCP attach, web mode, components, CSS) and `src/client/` (browser runtime, bundled into `dist/assets.js` by `build.mjs`). Example integration in `examples/notes-server/`. End-to-end tests in `tests/`.
- Build: `npm install && npm run build`. The build fails if a size budget is exceeded. Don't raise a budget without a reason.
- Test: `npm test` (unit + MCP host). `npm run test:web` also runs real Chrome via Python Playwright (`pip install playwright`; set `CHROME_PATH` or run `playwright install chromium`).
- Invariants:
  - Agent tool results never change. `tests/agent-snapshot.mjs` + `tests/baseline.json` check this.
  - No client JavaScript beyond the runtime.
  - All UI helper tools are `visibility: ["app"]`.

## Known gaps
- Not yet run inside a real host (Claude, ChatGPT, VS Code).
- State is in memory on one process; multiple instances need a shared change feed.
- Web mode trusts the MCP server's own user identity (authInfo).
