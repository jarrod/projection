# Web mode

Web mode serves the same UI on a normal URL, for people who want it open in a tab. There is no sign-in. The agent hands the person a single-use link, and the browser then acts as that MCP user.

![The link's Continue page](screenshots/shot-gate.png)

## Set it up

```ts
export const ui = defineUi({
  name: "notes", view,
  web: { origin: "https://app.example.com", tool: "open_notes_in_browser" },
});

http.createServer((req, res) => ui.site!.node(req, res)).listen(3000);
// Express: app.use((req, res, next) => ui.site!.node(req, res, next)), at the root, before body parsers
// Fetch runtimes: await ui.site!.fetch(request), which returns null outside its path
```

`web.tool` adds one tool the model can see. When called, it asks the host to open the link, so the link doesn't pass through the model. Hosts that can't do that get the link as text. To send a link from one of your own tools instead, call `ui.openInBrowser(extra, { server })`.

## The link

- It works once, for two minutes by default.
- Opening it shows a Continue page, so link previews in chat apps can't use it up. Pressing Continue sets a session cookie.
- It signs the browser in without asking for anything else. The MCP spec says servers shouldn't send links like this. Projection does it on purpose, so that people never have to sign in, and keeps the risk small by making the link single-use, short-lived and redeemable only from its own page.

## The session

- It acts as the MCP user who got the link, and lasts an hour by default (`web.sessionTtl`), never longer than that user's MCP auth.
- It doesn't end when the MCP connection closes. Call `ui.site.revoke(user)` when someone signs out.
- Tool calls from the browser can't send notifications or requests back to the client.

## Deploying

Links and sessions live in memory. Run one instance, or use sticky routing, and expect a restart to sign everyone out.
