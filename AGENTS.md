# mcp-projector: for coding agents

The MCP server is the app, and agents do the work through its tools. This library gives people a live view of it. A `view` function on the server returns HTML, and every button in it calls one of the server's own tools. A person gets to the view through a single-use link the agent sends with `open_<name>_in_browser`.

## Integrate

For the full walkthrough, follow the skill in `skills/mcp-projector/SKILL.md`. In short:

```ts
// src/ui.ts: all UI code lives in this one file
export const ui = defineUi({ name: "notes", view: ({ user, params }) => html`...` });

// where the server is created: the only change to existing code
const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));
```

## Gotchas

- Call `ui.attach()` before any tool is registered. It throws otherwise.
- If data changes outside a tool call (a cron job, a webhook), call `ui.write()`, or open views won't update.
- `view` must return `` html`...` ``. Values are escaped. Use `raw()` only for HTML you built yourself.
- No client JavaScript. For interaction, use `tool`, `set` (view params), `Dialog`, `Menu` and `Tabs`.
- Give anything that repeats an `id`. A `Table` needs `id` and `rowKey`, or its rows rebuild and lose focus.
- Form values arrive as strings. Put ids and numbers in `args`.
- `params` comes from the viewer and can hold any JSON, so read it defensively: `String(params.q ?? "")`.
- Authenticated requests need `authInfo.extra.sub`, or an `identify` function. In tool handlers, scope data with `ui.identify(extra)`, so tools and the view agree on the user.
- A hosted server needs `web: { origin }` and must route requests to `ui.site.node` or `ui.site.fetch`. Without an origin, links only work on the same machine.
- Run one long-lived Node process. Links and sessions are kept in memory, so serverless runtimes won't work.

## Check

Test with `testUi` from `mcp-projector/testing`: it drives the server as an agent and as a viewer, with no browser. The example is in `docs/getting-started.md`.

## Where to look

| Need | File |
|---|---|
| Components, props and options | The types in `src/ui/components.ts`, `src/ui.ts` and `src/web.ts` |
| Patterns: queues, filters, paging, detail views | `skills/mcp-projector/references/recipes.md` |
| From a symptom to its fix | `skills/mcp-projector/references/troubleshooting.md` |
| Links, sessions, hosting | `docs/web-mode.md` |
| What changed between versions | `CHANGELOG.md` |
