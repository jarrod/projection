# projection

Library: `mcp-projection`. It adds a live, styled UI for humans to an MCP server without changing agent-facing tools.

- **Read `AGENTS.md` first.** It has the API, the rules and the components.
- Layout: library in `src/` (`ui.ts` core and MCP attach, `web.ts` web mode, `ui/` components and CSS) and `src/client/` (browser runtime, bundled into `dist/assets.js` by `build.mjs`). Example integration in `examples/notes-server/`. End-to-end tests in `tests/`.
- Build: `npm install && npm run build`. The build fails if a size budget is exceeded. Don't raise a budget without a reason.
- Test: `npm test` (agent snapshot + unit + MCP host). `npm run test:web` also runs real Chrome via Python Playwright (`pip install playwright`; set `CHROME_PATH` or run `playwright install chromium`).
- Dev loop: `node tests/dev.mjs`, then open http://localhost:3000/dev. Edits to `src/` or the example rebuild (about 1 s), restart with seed data, and the open page reloads itself.
- Invariants:
  - Agent tool results never change. `npm test` diffs `tests/agent-snapshot.mjs` output against `tests/baseline.json`.
  - No client JavaScript beyond the runtime.
  - The server keeps no per-viewer state: view params live in the browser, and `p_sync` is a pure function of (user, params) plus one change counter.
  - UI actions go through the server's own `tools/call` handler. Never call a tool handler directly.
  - No sign-in of its own: identity always comes from MCP `authInfo`.
  - Smallest footprint wins. Adding an option, attribute or component needs a reason.

## Known gaps
- Not yet run inside a real host (Claude, ChatGPT, VS Code). Unverified there: that `visibility: ["app"]` is honoured, and that a held `p_sync` call (up to 25 s) is tolerated.
- With several server instances, a change made on one reaches viewers on another only when their poll times out (up to 25 s).
- The whole view is sent when it changes; very large views would want per-region updates.
