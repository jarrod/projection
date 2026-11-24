# Users and security

Who the viewer is, and what a UI exposes.

## Who is viewing

The view gets a stable `user`. Projection has no sign-in of its own, so identity always comes from MCP `authInfo`.

- Default: `authInfo.extra.sub`, or `"local"` when the request carries no auth (stdio). Without auth, every viewer is the same user.
- An authenticated request with no `extra.sub` throws `No user id: set authInfo.extra.sub in your token verifier, or return one from defineUi({ identify }).` A client id names the agent app, not the person, so it is never used as the user.
- Override with `defineUi({ identify: (extra) => ... })`. Returning nothing throws.
- In a tool handler, call `ui.identify(extra)` so the tool and the view agree on who is asking.

```ts
server.registerTool("add_note", { inputSchema: { title: z.string() } }, async ({ title }, extra) => {
  store.add(ui.identify(extra), title);
  return text("added");
});
```

In web mode, a tool call from the browser carries the `authInfo` of the MCP request that minted the link. It cannot send notifications or requests, so a handler that needs `sendNotification` or a client id will not work there. See [Web mode](web-mode.md#how-a-browser-session-works).

## What to watch

- **Escaping.** `html` escapes everything. `raw()` is only for HTML you produced.
- **Links.** Check URL schemes before rendering user-supplied links. `Menu` item `href`s must be http(s), mailto or relative.
- **Tools are open to the viewer.** The UI calls tools through your handler, so validation, defaults and output checks run. But any tool a control calls can also be called by anyone who can open the UI, with any arguments your schema accepts. Validate in the handler where it matters, and put controls only on tools a human should run.
- **Params are untrusted.** Read them defensively: `String(params.q ?? "")`, clamp numbers, check against an allowed list.
- **Scope by user.** Filter per-user data by `user` in the view and by `ui.identify(extra)` in tools. Without authentication, every viewer is the same user.
- **Web mode adds no authentication.** It inherits your MCP server's notion of identity, and its single-use link is a pre-authenticated URL. [Web mode](web-mode.md#the-single-use-link) explains what bounds it.
