# Recipes

Tested patterns. Each was compiled and exercised with `testUi` against `mcp-projection` 0.2. Adapt names to the server you're working on. Imports come from `"mcp-projection"`.

## Contents

1. [Shell and leaves](#1-shell-and-leaves)
2. [Collection with inline status and delete confirm](#2-collection-with-inline-status-and-delete-confirm)
3. [Create dialog](#3-create-dialog)
4. [Search box with an app-only tool](#4-search-box-with-an-app-only-tool)
5. [Fixed filters with tabs](#5-fixed-filters-with-tabs)
6. [Approval queue, with failures shown](#6-approval-queue-with-failures-shown)
7. [Run monitor updated from outside tools](#7-run-monitor-updated-from-outside-tools)
8. [Settings switches and selects](#8-settings-switches-and-selects)
9. [Pagination](#9-pagination)
10. [Activity feed](#10-activity-feed)
11. [Per-item fragments and targeted writes](#11-per-item-fragments-and-targeted-writes)
12. [Per-user data](#12-per-user-data)
13. [Fragments that can't throw](#13-fragments-that-cant-throw)
14. [Read-only dashboard](#14-read-only-dashboard)
15. [Custom CSS](#15-custom-css)
16. [Web mode deployments](#16-web-mode-deployments)

## 1. Shell and leaves

The root reads nothing, so it never re-renders. Dialogs live in it. Leaves read data.

```ts
ui.fragment("app", async ({ frag }) => html`
  <div class="stack" style="--gap:20px;max-width:960px;margin:0 auto">
    ${Header({
      title: "Tasks",
      description: html`<span class="row" style="--gap:6px">${Dot({ tone: "ok", pulse: true, label: "Live" })} Shared with your assistant</span>`,
      actions: Button({ opens: "new-task", icon: "plus" }, "New task"),
    })}
    ${await frag("stats")}
    ${Card({ title: "All tasks", flush: true, actions: Input({ name: "q", placeholder: "Search", tool: "ui_set_query", debounce: 250 }) }, await frag("list"))}
    ${Card({ title: "Activity" }, await frag("events"))}
    ${/* dialogs here, see recipe 3 */ ""}
  </div>`);

ui.fragment("stats", async ({ read }) => {
  const tasks = await read("tasks");
  const n = (s: Status) => tasks.filter((t) => t.status === s).length;
  return Grid({ min: 140 },
    Stat({ label: "To do", value: n("todo") }),
    Stat({ label: "Doing", value: n("doing"), tone: "info" }),
    Stat({ label: "Done", value: n("done"), tone: "ok" }));
});
```

## 2. Collection with inline status and delete confirm

`id` comes from `args` (a number, since UI calls skip zod coercion); `status` comes from the select (a string limited by its options). Each row carries its own small confirm dialog.

```ts
ui.fragment("list", async ({ read }) => {
  const [tasks, view] = await Promise.all([read("tasks"), read("view")]);
  const q = view.q.toLowerCase();
  const rows = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks;
  return Table<Task>({
    id: "tasks", rows, rowKey: (t) => t.id,
    empty: html`<div style="padding:16px">${Empty({ title: q ? `Nothing matches "${view.q}"` : "No tasks yet", description: "Ask your assistant to add one." })}</div>`,
    columns: [
      { label: "#", cell: (t) => t.id, mono: true, width: "48px" },
      { label: "Task", cell: (t) => Stack({ gap: 2 }, html`<strong style="font-weight:500">${t.title}</strong>`, Muted(t.owner)) },
      { label: "Status", width: "140px", cell: (t) =>
        Select({ name: "status", value: t.status, options: ["todo", "doing", "done"], tool: "set_status", args: { id: t.id } }) },
      { label: "", align: "right", width: "56px", cell: (t) => html`
        ${Button({ variant: "ghost", size: "sm", icon: "trash", label: `Delete task ${t.id}`, opens: `del-${t.id}` })}
        ${Dialog({ id: `del-${t.id}`, title: "Delete task?", description: html`“${t.title}” will be removed for you and your assistant.` },
          Form({ tool: "delete_task", args: { id: t.id }, close: true },
            html`<div class="actions">${Close(`del-${t.id}`)}${Button({ type: "submit", variant: "danger" }, "Delete")}</div>`))}` },
    ],
  });
});
```

`writes: { set_status: ["tasks", "events"], delete_task: ["tasks", "events"] }`.

## 3. Create dialog

Form fields arrive as strings. Anything typed, or anything the schema would default, goes in `args`.

```ts
Dialog({ id: "new-task", title: "New task", description: "Your assistant sees it straight away." },
  Form({ tool: "add_task", args: { owner: "you" }, close: true },        // schema: owner: z.string().default("agent")
    Input({ name: "title", label: "Title", required: true }),
    html`<div class="actions">${Close("new-task")}${Button({ type: "submit" }, "Create")}</div>`))
```

Open it with `Button({ opens: "new-task", icon: "plus" }, "New task")`. `close: true` hides it after success; the form resets itself.

## 4. Search box with an app-only tool

UI state stays out of the agent's tool list. One identity function serves both `defineUi` and the tool.

```ts
// identify.ts
export const userOf = (extra: any): string => extra?.authInfo?.extra?.sub ?? extra?.authInfo?.clientId ?? "local";

// store.ts
export const views = new Map<string, { q: string }>();

// ui.ts
export const ui = defineUi({
  name: "tasks",
  identify: userOf,
  load: { tasks: () => store.list(), view: ({ user }) => views.get(user) ?? { q: "" } },
  writes: { /* ...existing tools... */ ui_set_query: ["view"] },
  attachTo: ["list_tasks"],
});
// the input, anywhere in the shell:
Input({ name: "q", placeholder: "Search", tool: "ui_set_query", debounce: 250 })

// server.ts, inside createServer() after the existing tools
server.registerTool("ui_set_query", {
  description: "UI: set the search query",
  inputSchema: { q: z.string() },
  _meta: { ui: { visibility: ["app"] } },
}, async ({ q }, extra) => { views.set(userOf(extra), { q }); return { content: [{ type: "text", text: "ok" }] }; });
```

The list fragment reads `view` and filters (recipe 2). Without authentication all viewers are `"local"` and share the search.

## 5. Fixed filters with tabs

For a few fixed views, tabs need no tool at all. Selection stays in the browser.

```ts
${Card({ flush: true }, html`<div style="padding:4px 16px 0">${Tabs({ id: "view", tabs: [
  { label: "All", content: await frag("list") },
  { label: "Pinned", content: await frag("list", { filter: "pinned" }) },
] })}</div>`)}

ui.fragment("list", async ({ read, params }) => {
  const notes = (await read("notes")).filter((n) => params.filter !== "pinned" || n.pinned);
  return Table<Note>({ id: `notes-${params.filter ?? "all"}`, rows: notes, rowKey: (n) => n.id, columns: [/* ... */] });
});
```

Note the table id depends on the filter: two tables of the same rows need different ids.

## 6. Approval queue, with failures shown

The agent tool `decide` reports expected failures as `isError`, which the UI would treat as success. An app-only twin calls the same core function and **throws**, so the button shows the message (`p-error`). The agent's tool is unchanged.

```ts
// store.ts: one core function, throws on a bad request
decide(id: number, decision: "approve" | "reject") {
  const a = approvals.find((x) => x.id === id);
  if (!a) throw new Error(`No approval #${id}`);
  if (a.state !== "pending") throw new Error(`#${id} was already ${a.state}`);
  a.state = decision === "approve" ? "approved" : "rejected";
  return a;
},

// server.ts: existing agent tool (unchanged) ...
server.registerTool("decide", { description: "Approve or reject a request", inputSchema: { id: z.number(), decision: z.enum(["approve", "reject"]) } }, async ({ id, decision }) => {
  try { const a = ops.decide(id, decision); return text(`#${a.id} ${a.state}`); }
  catch (e: any) { return { ...text(e.message), isError: true }; }
});
// ... and the UI twin
server.registerTool("ui_decide", { description: "UI: approve or reject", inputSchema: { id: z.number(), decision: z.enum(["approve", "reject"]) }, _meta: { ui: { visibility: ["app"] } } },
  async ({ id, decision }) => { const a = ops.decide(Number(id), decision); return text(`#${a.id} ${a.state}`); });

// ui.ts  (writes: { request_approval: ["approvals"], decide: ["approvals"], ui_decide: ["approvals"] })
ui.fragment("queue", async ({ read }) => {
  const pending = (await read("approvals")).filter((a) => a.state === "pending");
  return Card({ title: "Waiting for you", description: `${pending.length} pending`, flush: true },
    Table<Approval>({
      id: "queue", rows: pending, rowKey: (a) => a.id,
      empty: html`<div style="padding:16px">${Empty({ title: "Nothing to approve", description: "Requests from your assistant show up here." })}</div>`,
      columns: [
        { label: "Request", cell: (a) => html`${a.title} ${Muted(`from ${a.requestedBy}`)}` },
        { label: "", width: "200px", cell: (a) => html`<div class="row" style="--gap:6px;justify-content:flex-end">
          ${Button({ size: "sm", variant: "secondary", tool: "ui_decide", args: { id: a.id, decision: "reject" } }, "Reject")}
          ${Button({ size: "sm", tool: "ui_decide", args: { id: a.id, decision: "approve" } }, "Approve")}</div>` },
      ],
    }));
});
```

`text` is a local helper: `const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });`.

## 7. Run monitor updated from outside tools

A worker advances jobs and tells the UI. A row menu offers cancel.

```ts
// worker.ts
export function tick() {
  let changed = false;
  for (const r of ops.runs()) if (r.state === "running") { r.progress = Math.min(100, r.progress + 25); if (r.progress === 100) r.state = "done"; changed = true; }
  if (changed) return ui.write("runs");
}
setInterval(tick, 1000).unref();

// ui.ts  (writes: { start_run: ["runs"], cancel_run: ["runs"] })
const RUN_TONE: Record<Run["state"], Tone> = { running: "info", done: "ok", cancelled: "neutral" };
ui.fragment("runs", async ({ read }) => {
  const runs = await read("runs");
  const running = runs.filter((r) => r.state === "running").length;
  return Card({ title: "Runs", flush: true,
      actions: running > 0 ? Row({ gap: 6 }, Dot({ tone: "info", pulse: true, label: "Running" }), Muted(`${running} running`)) : undefined },
    Table<Run>({
      id: "runs", rows: runs, rowKey: (r) => r.id,
      empty: html`<div style="padding:16px">${Muted("No runs yet.")}</div>`,
      columns: [
        { label: "Run", cell: (r) => html`${Mono(r.id)} ${r.name}` },
        { label: "State", width: "120px", cell: (r) => Badge({ tone: RUN_TONE[r.state], dot: true }, r.state) },
        { label: "Progress", width: "90px", align: "right", mono: true, cell: (r) => `${r.progress}%` },
        { label: "", width: "48px", align: "right", cell: (r) => r.state === "running" && html`
          ${Button({ variant: "ghost", size: "sm", icon: "more", label: `Actions for ${r.id}`, opens: `run-menu-${r.id}` })}
          ${Menu({ id: `run-menu-${r.id}`, items: [{ label: "Cancel run", icon: "x", danger: true, tool: "cancel_run", args: { id: r.id } }] })}` },
      ],
    }));
});
```

Use `? :` for optional props like `actions`: `false` is not `null`, so `actions: cond && x` renders an empty header slot when `cond` is false.

## 8. Settings switches and selects

`Checkbox` sends `{ [name]: boolean }`; `Select` sends `{ [name]: string }`. Name them after the tool's parameters.

```ts
// tools: set_auto_approve({ enabled: z.boolean() }), set_region({ region: z.enum([...]) })
ui.fragment("settings", async ({ read }) => {
  const s = await read("settings");
  return Card({ title: "Settings" }, Grid({ min: 220 },
    Checkbox({ name: "enabled", label: "Auto-approve small requests", switch: true, checked: s.autoApprove, tool: "set_auto_approve" }),
    Select({ name: "region", label: "Region", value: s.region, options: ["us-east", "eu-west", "ap-south"], tool: "set_region" })));
});
```

## 9. Pagination

Page state is per user, set by an app-only tool. Bound it in the fragment, since nothing validates UI arguments.

```ts
// store.ts
export const pages = new Map<string, number>();
// server.ts
server.registerTool("ui_page", { description: "UI: change page", inputSchema: { page: z.number() }, _meta: { ui: { visibility: ["app"] } } },
  async ({ page }, extra) => { pages.set(userOf(extra), Math.max(0, Number(page))); return text("ok"); });

// ui.ts  (load: { page: ({ user }) => pages.get(user) ?? 0 }, writes: { ui_page: ["page"] })
const PAGE = 20;
ui.fragment("history", async ({ read }) => {
  const [all, page] = await Promise.all([read("approvals"), read("page")]);
  const done = all.filter((a) => a.state !== "pending").reverse();
  const pageCount = Math.max(1, Math.ceil(done.length / PAGE));
  const p = Math.min(page, pageCount - 1);
  const rows = done.slice(p * PAGE, p * PAGE + PAGE);
  return Card({ title: "History", flush: true, footer: Row({ between: true },
      Muted(`Page ${p + 1} of ${pageCount}`),
      Row({ gap: 6 },
        Button({ size: "sm", variant: "secondary", disabled: p === 0, tool: "ui_page", args: { page: p - 1 } }, "Previous"),
        Button({ size: "sm", variant: "secondary", disabled: p >= pageCount - 1, tool: "ui_page", args: { page: p + 1 } }, "Next"))) },
    Table<Approval>({ id: "history", rows, rowKey: (a) => a.id, empty: html`<div style="padding:16px">${Muted("No decisions yet.")}</div>`,
      columns: [
        { label: "#", key: "id", mono: true, width: "48px" },
        { label: "Request", key: "title" },
        { label: "Outcome", width: "120px", cell: (a) => Badge({ tone: a.state === "approved" ? "ok" : "bad" }, a.state) },
      ] }));
});
```

## 10. Activity feed

Stable ids on `li` make new rows slide in and flash while old ones stay put. Cap the list in the store.

```ts
ui.fragment("events", async ({ read }) => {
  const events = await read("events");
  if (events.length === 0) return Muted("Nothing yet.");
  return html`<ul class="stack" style="--gap:6px;list-style:none;margin:0;padding:0">${events.map((e) =>
    html`<li id="ev-${e.at}" class="row sm">${Mono(new Date(e.at).toISOString().slice(11, 19))} ${e.text}</li>`)}</ul>`;
});
```

Use a real event id if two events can share a millisecond.

## 11. Per-item fragments and targeted writes

Per-item fragments must live in a list or grid, never inside a table.

```ts
// load: { tasks: () => store.list(), task: ({ id }) => store.get(Number(id)) }
ui.fragment("board", async ({ read, frag }) => {
  const tasks = await read("tasks");
  return html`<div class="grid" style="--min:200px">${await Promise.all(tasks.map((t) => frag("card", { id: String(t.id) })))}</div>`;
});
ui.fragment("card", async ({ read, params }) => {
  const t = await read("task", params.id);
  if (!t) return html``;                        // deleted since the parent rendered
  return Card({ title: t.title }, Row({ between: true }, Badge({ tone: TONE[t.status], dot: true }, t.status), Muted(t.owner)));
});

// where one task changes outside a tool:
await ui.write(`task:${id}`);                   // only that card re-renders
```

`write("tasks")` (from `writes`) re-renders `board`, which re-renders every card.

## 12. Per-user data

```ts
defineUi({ ..., load: { mine: ({ user }) => store.assignedTo(user) } });
ui.fragment("mine", async ({ read, user }) => Card({ title: `Assigned to ${user}` }, /* ... */));
```

Needs real authentication: without it every viewer is `"local"`.

## 13. Fragments that can't throw

A throw during a write fails the agent's tool call. Guard anything that can fail.

```ts
ui.fragment("usage", async ({ read }) => {
  try {
    const usage = await read("usage");
    return Stat({ label: "This month", value: usage.total });
  } catch (e) {
    console.error("[ui] usage", e);
    return Muted("Usage is unavailable right now.");
  }
});
```

## 14. Read-only dashboard

```ts
export const ui = defineUi({
  name: "status",
  readOnly: true,                                  // no p_call, smaller runtime
  load: { runs: () => store.runs() },
  writes: { start_run: ["runs"], cancel_run: ["runs"] },  // still refresh the screen
  attachTo: ["get_status"],
});
```

## 15. Custom CSS

Use tokens so dark mode keeps working.

```ts
defineUi({ ..., css: `
  .lane { min-height: 120px; padding: 8px; border: 1px dashed var(--p-line-2); border-radius: var(--p-r); }
  .lane > h3 { font-size: 12px; font-weight: 500; color: var(--p-fg-3); margin-bottom: 8px; }
` });
```

## 16. Web mode deployments

All forms need `defineUi({ web: { origin } })`. `origin` is what the browser uses, not the bind address.

**stdio server with a side port** (one process, so state and writes are shared):

```ts
await createServer().connect(new StdioServerTransport());
if (process.env.UI_PORT) http.createServer((req, res) => ui.site!.node(req, res)).listen(+process.env.UI_PORT);
```

**Streamable HTTP server on the same listener**:

```ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
http.createServer(async (req, res) => {
  if (req.url?.startsWith("/mcp")) {
    const server = createServer();                                   // calls ui.attach inside
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    return transport.handleRequest(req, res);
  }
  return ui.site!.node(req, res);
}).listen(3000);
```

**Express**: mount at the app root and before body parsers (the adapter reads the body itself, and Express strips mount paths from `req.url`).

```ts
app.use((req, res, next) => ui.site!.node(req, res, next));
app.use(express.json());
```

**Fetch-style frameworks** (Bun, Deno, Hono, Next route handlers):

```ts
const response = await ui.site!.fetch(request);
if (response) return response;
```

**A new tool that opens the UI** (instead of `web.tool`, when you want your own wording). Never add this to an existing tool:

```ts
server.registerTool("share_ops", { description: "Open the operations dashboard in the user's browser", inputSchema: {} }, async (_args, extra) => {
  const r = await ui.openInBrowser(extra, { server, message: "Open the operations dashboard" });
  return text(r.opened ? "Opened in the browser." : r.declined ? "The user declined." : `Single-use link: ${r.url}`);
});
```

Without URL elicitation support in the client, the link is returned as text, so it enters the model's context. `web.tool` behaves the same way.
