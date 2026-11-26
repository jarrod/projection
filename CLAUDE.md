# projector

Library: `mcp-projector`. It adds a live, styled UI for humans to an MCP server. Existing tools, schemas and results never change; it adds one model-visible tool, `open_<name>_in_browser` (none with `web: false` or `web: { tool: false }`).

- **Read `AGENTS.md` first.** It has the integration and the gotchas. The full API is the documented types in `src/`; human docs are in `docs/`.
- Layout: library in `src/` (`ui.ts` core and MCP attach, `web.ts` web mode, `ui/` components and CSS) and `src/client/` (browser runtime, bundled into `dist/assets.js` by `scripts/build.ts`). Example integration in `examples/notes-server/`. Tests in `tests/` (browser and Workers suites in `tests/e2e/`); build and dev scripts in `scripts/`.
- Node 22.18 or later, pnpm (`corepack enable` picks the version in `packageManager`). The repo is a pnpm workspace: the root package plus `examples/*`, which depend on it with `workspace:*`.
- Release: bump `version` (and the changelog) in a PR, merge it, then run the `release` workflow. It tags `v<version>` on a commit that adds the built `dist/` on top of main; apps install that tag. main never holds `dist/`.
- Build: `pnpm install && pnpm build`. The build fails if a size budget is exceeded. Don't raise a budget without a reason.
- Test: `pnpm test` (build, `pnpm typecheck` over the tests, scripts and example, then the Vitest `unit` project: `tests/*.test.ts`). Tests are TypeScript, run by Vitest; they import the library as `mcp-projector` and the example from its `src/`. `pnpm test:web` runs real Chrome via `playwright-core` (uses your installed Chrome, or set `CHROME_PATH`; needs port 3000 free). `pnpm test:workers` runs the Worker example under `wrangler dev`. `pnpm vitest run sessions -t "claim"` runs one file or test, `pnpm test:watch` reruns on change. Child processes get `childEnv()` from `tests/helpers.ts`, since Vitest sets `DEV` and `NODE_ENV=test`.
- CI (`.github/workflows/ci.yml`) is limited on purpose, because Actions minutes cost money: one Node version, `pnpm test` and a pack check, on pull requests and pushes to main. Never add the browser or Workers suites to CI.
- Dev loop: `pnpm dev`, then open http://localhost:3000/dev. Edits to `src/` or the example rebuild (about 1 s), restart with seed data, and the open page reloads itself.
- Invariants:
  - Agent tool results never change. `tests/agent-results.test.ts` registers the same tools with and without `ui.attach` and checks the model sees the same tools and results.
  - No client JavaScript beyond the runtime.
  - Projector never adds state or auth context outside the MCP server; it only reflects the MCP server's state and the agent's auth. A person sees the UI only because the agent opened it, and has no identity, account or session of their own.
  - The browser carries exactly the agent's MCP auth: the agent's bearer token, sealed in the link and cookie, sent with every browser request to the server's own MCP endpoint (`web.mcp`), so the server checks it as it checks the agent. Only the local 127.0.0.1 UI (no `web.origin`) runs browser calls in process; with an origin, `web.mcp` is required and everything fails closed through the server's own auth.
  - The server keeps nothing between requests: view params live in the browser and `p_sync` renders the view from (user, params) and what its read tools return. The one exception is the default `web.claim`, which remembers used links in the process.
  - The view reads only by calling read tools (`readOnlyHint` or `reads`). Data changes only through tool calls; projector adds no other path.
  - UI actions go through the server's own `tools/call` handler. Never call a tool handler directly.
  - No sign-in of its own: identity always comes from MCP `authInfo`, as the server's auth gives it.
  - Smallest footprint wins. Adding an option, attribute or component needs a reason.

## Known gaps
- Not yet run inside a real host (Claude, ChatGPT, VS Code). Unverified there: that `visibility: ["app"]` is honoured.
- Pages check every `poll` seconds (default 5), so others' changes take up to that long, and every check runs the view's read tools.
- The cookie keeps the agent's token until `web.sessionTtl` or the token's expiry. A revoked token is refused by the server on the next request; a refreshed agent token is not passed on, so the browser needs a new link when the old token expires.
- `web.mcp` must be a stateless MCP endpoint; servers that keep MCP sessions mount one beside their main route. Servers that accept only the 2026-07-28 protocol (`createMcpHandler` with `legacy: "reject"`) are not supported yet for browser calls.
- Browser requests reach `web.mcp` from projector, not from the browser: the server must authorise them by token, not by network source.
- The default `web.claim` is per process: with several instances or on serverless, links are single-use only if the integrator backs `claim` with shared storage.
- The single-use link is a pre-authenticated URL carrying the agent's token, which the MCP elicitation spec says servers must not send. Kept on purpose: the person acts as the agent and never signs in; see `docs/web-mode.md`.
- Morph: when an element without an id disappears, the unkeyed siblings after it are rebuilt (an input there loses focus and text). The fix did not fit the runtime budget.
- The whole view is sent when it changes; very large views would want per-region updates.
