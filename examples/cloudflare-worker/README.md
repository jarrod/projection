# Notes on Cloudflare Workers

The notes server from `../notes-server`, run as a Worker with D1. projector is used as it is, with nothing added for Workers.

Run it locally:

    npm install
    npx wrangler d1 execute DB --local --file schema.sql
    npx wrangler dev --var UI_ORIGIN:http://localhost:8787 --var UI_SECRET:<32 or more random characters>

The MCP server is at `/mcp`. Call `open_notes_in_browser` from any MCP client to get a link to the UI.

Only these parts are Cloudflare-specific:

- `src/index.ts`: routes `/mcp` to `handleMcp` (the MCP SDK's `createMcpHandler`, in `src/server.ts`), `/ui` to `ui.site.fetch`, redirects `/` to `/ui/` and answers 404 to the rest.
- `src/server.ts` and `src/ui.ts`: `import { env } from "cloudflare:workers"` for the `DB` binding and the two vars. `ui.attach` is the only projector line in the tools.
- `src/ui.ts`: `web.mcp: (req) => handleMcp(req)` sends the browser's calls to the same `/mcp` handler in-process, as normal `tools/call` requests with the agent's own bearer token (a Worker fetching its own URL is unreliable, so pass a function, not a URL).
- `src/ui.ts`: `web.claim` is a D1 insert into `used_links`, so a link works once across all isolates.
- `wrangler.jsonc`: the D1 binding. `nodejs_compat` is not set.

Before you deploy, set `UI_ORIGIN` to the public https origin and `UI_SECRET` as a Worker secret (`wrangler secret put UI_SECRET`), and give `DB` a real `database_id`. Without an origin and secret projector would try to serve the UI itself on 127.0.0.1, which a Worker cannot do.
