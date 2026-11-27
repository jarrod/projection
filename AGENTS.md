# mcp-projector: for coding agents

The MCP server is the app, and agents do the work through its tools. This library gives people a live view of it. A `view` function reads data by calling the server's read tools and returns HTML, and every button in it calls one of the server's own tools. Projector has no other path to the data, and the only change to existing server code is `ui.attach`. A person gets to the view through a single-use link the agent sends with `open_<name>_in_browser`.

## Integrate

For the full walkthrough, follow the skill in `skills/mcp-projector/SKILL.md`. In short:

```ts
// src/ui.ts: all UI code lives in this one file
export const ui = defineUi({ name: "notes", view: async ({ call, params }) => html`...${(await call("list_notes")).structuredContent}...` });

// where the server is created: the only change to existing code
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
```

## Gotchas

- Call `ui.attach()` before any tool is registered. It throws otherwise.
- Don't change the server's tools or handlers for the UI, and don't import its store or database into the UI. Read with `call`. If no tool returns what the UI needs, say so instead of adding one.
- `call` only runs read tools: `readOnlyHint: true`, or listed in `defineUi({ reads })`. Use `reads` for an unannotated tool that only reads; never for one that writes.
- Open pages check for changes every 5 seconds (`poll`) and after their own actions. Don't add a way for server code to signal changes.
- `view` must return `` html`...` ``. Values are escaped. Use `raw()` only for HTML you built yourself.
- No client JavaScript. For interaction, use `tool`, `set` (view params), `Dialog`, `Menu` and `Tabs`.
- Give anything that repeats an `id`. A `Table` needs `id` and `rowKey`, or its rows rebuild and lose focus.
- Form values arrive as strings. Put ids and numbers in `args`.
- `params` comes from the viewer and can hold any JSON, so read it defensively: `String(params.q ?? "")`.
- Authenticated requests need `authInfo.extra.sub`, or an `identify` function. The browser carries the agent's own token and every UI request goes through the server's auth, so tools scope data as they already do. Projector adds no auth or state of its own.
- A hosted server needs `web: { origin, secret, mcp }` and must route requests to `ui.site.node` or `ui.site.fetch`. `secret` is 32+ random characters from an environment variable (`openssl rand -base64 32`), never committed. Without an origin, links only work on the same machine.
- A hosted server sets `web.mcp`: its own stateless MCP endpoint, as a URL or an in-process handler. Every browser request goes there with the agent's token. On several instances or serverless, also a `web.claim` backed by real storage. See `docs/web-mode.md`.

## Check

Test with `testUi` from `mcp-projector/testing`: it drives the server as an agent and as a viewer, with no browser. The example is in `docs/getting-started.md`.

## Where to look

| Need | File |
|---|---|
| Components, props and options | The types in `dist/ui/components.d.ts`, `dist/ui.d.ts` and `dist/web.d.ts` (in this repo: `src/ui/components.ts`, `src/ui.ts`, `src/web.ts`) |
| Patterns: queues, filters, paging, detail views | `skills/mcp-projector/references/recipes.md` |
| From a symptom to its fix | `skills/mcp-projector/references/troubleshooting.md` |
| Links, sessions, hosting | `docs/web-mode.md` |
| What changed between versions | `CHANGELOG.md` |
