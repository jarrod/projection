# Recipes

Patterns for `mcp-projection` 0.3, written against the task-server shape below and exercised with `testUi`. Adapt names to the server you're working on. Imports come from `"mcp-projection"`.

Common shape used in the snippets:

```ts
type Status = "todo" | "doing" | "done";
type Task = { id: number; title: string; owner: string; status: Status };
// store.list(): Task[], store.add(title, owner), store.setStatus(id, status), store.remove(id)
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
```

## Contents

1. [One view built from functions](#1-one-view-built-from-functions)
2. [Collection with inline status and delete confirm](#2-collection-with-inline-status-and-delete-confirm)
3. [Create dialog](#3-create-dialog)
4. [Search box](#4-search-box)
5. [Filters and tabs](#5-filters-and-tabs)
6. [Approval queue, with failures shown](#6-approval-queue-with-failures-shown)
7. [Run monitor updated from outside tools](#7-run-monitor-updated-from-outside-tools)
8. [Settings switches and selects](#8-settings-switches-and-selects)
9. [Pagination](#9-pagination)
10. [Activity feed](#10-activity-feed)
11. [Detail view](#11-detail-view)
12. [Per-user data](#12-per-user-data)
13. [A view that can't throw](#13-a-view-that-cant-throw)
14. [Custom CSS and themes](#14-custom-css-and-themes)
15. [Web mode deployments](#15-web-mode-deployments)

## 1. One view built from functions

There is one `view`. Split it into plain functions that return `html`. Nothing is registered and nothing is cached: the whole view runs again after every tool call.

```ts
export const ui = defineUi({
  name: "tasks",
  attachTo: ["list_tasks"],
  view: ({ params }) => {
    const tasks = store.list();
    return html`
      <div class="stack" style="--gap:20px;max-width:960px;margin:0 auto">
        ${Header({
          title: "Tasks",
          description: html`<span class="row" style="--gap:6px">${Dot({ tone: "ok", pulse: true, label: "Live" })} Shared with your assistant</span>`,
          actions: Button({ opens: "new-task", icon: "plus" }, "New task"),
        })}
        ${Stats(tasks)}
        ${Card({ title: "All tasks", flush: true, actions: Input({ name: "q", placeholder: "Search", set: true, debounce: 250, value: String(params.q ?? "") }) }, List(tasks, params))}
        ${NewTaskDialog()}
      </div>`;
  },
});

const Stats = (tasks: Task[]) => {
  const n = (s: Status) => tasks.filter((t) => t.status === s).length;
  return Grid({ min: 140 },
    Stat({ label: "To do", value: n("todo") }),
    Stat({ label: "Doing", value: n("doing"), tone: "info" }),
    Stat({ label: "Done", value: n("done"), tone: "ok" }));
};
```

`view` may be `async`. A view that returns a plain string throws.

## 2. Collection with inline status and delete confirm

`id` comes from `args` and is a number. `status` comes from the select as a string, checked by the tool's own schema (`z.enum`). Each row carries its own small confirm dialog.

```ts
const List = (tasks: Task[], params: Params) => {
  const q = String(params.q ?? "").toLowerCase();
  const rows = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks;
  return Table<Task>({
    id: "tasks", rows, rowKey: (t) => t.id,
    empty: html`<div style="padding:16px">${Empty({ title: q ? "Nothing matches" : "No tasks yet", description: "Ask your assistant to add one." })}</div>`,
    columns: [
      { label: "#", cell: (t) => t.id, mono: true, width: "48px" },
      { label: "Task", cell: (t) => Stack({ gap: 2 }, html`<strong style="font-weight:500">${t.title}</strong>`, Muted(t.owner)) },
      { label: "Status", width: "140px", cell: (t) =>
        Select({ name: "status", value: t.status, options: ["todo", "doing", "done"], tool: "set_status", args: { id: t.id } }) },
      { label: "", align: "right", width: "56px", cell: (t) => html`
        ${Button({ variant: "ghost", size: "sm", icon: "trash", label: `Delete task ${t.id}`, opens: `del-${t.id}` })}
        ${Dialog({ id: `del-${t.id}`, title: "Delete task?", description: html`${t.title} will be removed for you and your assistant.` },
          Form({ tool: "delete_task", args: { id: t.id }, close: true },
            html`<div class="actions">${Close(`del-${t.id}`)}${Button({ type: "submit", variant: "danger" }, "Delete")}</div>`))}` },
    ],
  });
};
```

The tools are `set_status({ id: z.number(), status: z.enum([...]) })` and `delete_task({ id: z.number() })`. Nothing else is needed for the UI to refresh.

## 3. Create dialog

Form fields arrive as strings. Fixed values go in `args`.

```ts
const NewTaskDialog = () =>
  Dialog({ id: "new-task", title: "New task", description: "Your assistant sees it straight away." },
    Form({ tool: "add_task", args: { owner: "you" }, close: true },
      Input({ name: "title", label: "Title", required: true }),
      html`<div class="actions">${Close("new-task")}${Button({ type: "submit" }, "Create")}</div>`));
```

Open it with `Button({ opens: "new-task", icon: "plus" }, "New task")`. `close: true` hides it after success; the form resets itself. Zod defaults on the tool run for UI calls too, so `owner` could also be left to `.default("agent")`.

## 4. Search box

Search text is a view param. It lives in the browser, so nothing is stored on the server and no extra tool is needed.

```ts
Input({ name: "q", placeholder: "Search", set: true, debounce: 250, value: String(params.q ?? "") })
```

`set: true` merges `{ q: "text" }` into the params and renders again. The view reads it with `String(params.q ?? "")`. Pass `value` so the box shows the current param after a reopen or a server render. Params are untrusted: any key can hold any JSON type.

## 5. Filters and tabs

For a few fixed views, tabs need no params. Selection stays in the browser.

```ts
Card({ flush: true }, html`<div style="padding:4px 16px 0">${Tabs({ id: "view", tabs: [
  { label: "All", content: List(tasks, params) },
  { label: "Doing", content: List(tasks.filter((t) => t.status === "doing"), params) },
] })}</div>`)
```

Two tables on one page need different `id`s (`Table({ id: "tasks-doing", ... })`), or their row ids collide.

For a filter that should apply to the whole view, use a param:

```ts
Select({ name: "status", value: String(params.status ?? ""), options: [{ value: "", label: "All" }, "todo", "doing", "done"], set: true })
// in the view
const status = String(params.status ?? "");
const rows = status ? tasks.filter((t) => t.status === status) : tasks;
```

## 6. Approval queue, with failures shown

A tool that fails can return `{ isError: true }` as agents expect. The UI shows its first text as `p-error` on the control that was used, and the control returns to the server's last render. No second tool is needed.

```ts
server.registerTool("decide", {
  description: "Approve or reject a request",
  inputSchema: { id: z.number(), decision: z.enum(["approve", "reject"]) },
}, async ({ id, decision }) => {
  const a = approvals.find((x) => x.id === id);
  if (!a) return { ...text(`No approval #${id}`), isError: true };
  if (a.state !== "pending") return { ...text(`#${id} was already ${a.state}`), isError: true };
  a.state = decision === "approve" ? "approved" : "rejected";
  return text(`#${id} ${a.state}`);
});

const Queue = (approvals: Approval[]) => {
  const pending = approvals.filter((a) => a.state === "pending");
  return Card({ title: "Waiting for you", description: `${pending.length} pending`, flush: true },
    Table<Approval>({
      id: "queue", rows: pending, rowKey: (a) => a.id,
      empty: html`<div style="padding:16px">${Empty({ title: "Nothing to approve", description: "Requests from your assistant show up here." })}</div>`,
      columns: [
        { label: "Request", cell: (a) => html`${a.title} ${Muted(`from ${a.requestedBy}`)}` },
        { label: "", width: "200px", cell: (a) => html`<div class="row" style="--gap:6px;justify-content:flex-end">
          ${Button({ size: "sm", variant: "secondary", tool: "decide", args: { id: a.id, decision: "reject" } }, "Reject")}
          ${Button({ size: "sm", tool: "decide", args: { id: a.id, decision: "approve" } }, "Approve")}</div>` },
      ],
    }));
};
```

## 7. Run monitor updated from outside tools

A worker advances jobs. It is not a tool call, so it tells the UI itself with `ui.write()`. A row menu offers cancel.

```ts
// worker.ts
setInterval(() => {
  let changed = false;
  for (const r of runs) if (r.state === "running") { r.progress = Math.min(100, r.progress + 25); if (r.progress === 100) r.state = "done"; changed = true; }
  if (changed) ui.write();
}, 1000).unref();

const RUN_TONE: Record<Run["state"], Tone> = { running: "info", done: "ok", cancelled: "neutral" };
const Runs = (runs: Run[]) => {
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
};
```

Use `? :` for optional props like `actions`: `false` is not `null`, so `actions: cond && x` renders an empty header slot when `cond` is false. `ui.write()` called many times in one tick wakes viewers once.

## 8. Settings switches and selects

`Checkbox` sends `{ [name]: boolean }`; `Select` sends `{ [name]: string }`. Name them after the tool's parameters.

```ts
// tools: set_auto_approve({ enabled: z.boolean() }), set_region({ region: z.enum([...]) })
const SettingsCard = (s: { autoApprove: boolean; region: string }) =>
  Card({ title: "Settings" }, Grid({ min: 220 },
    Checkbox({ name: "enabled", label: "Auto-approve small requests", switch: true, checked: s.autoApprove, tool: "set_auto_approve" }),
    Select({ name: "region", label: "Region", value: s.region, options: ["us-east", "eu-west", "ap-south"], tool: "set_region" })));
```

## 9. Pagination

The page number is a view param. Bound it in the view, since params are untrusted.

```ts
const PAGE = 20;
const History = (all: Approval[], params: Params) => {
  const done = all.filter((a) => a.state !== "pending").reverse();
  const pageCount = Math.max(1, Math.ceil(done.length / PAGE));
  const p = Math.min(Math.max(0, Math.floor(Number(params.page)) || 0), pageCount - 1);
  const rows = done.slice(p * PAGE, p * PAGE + PAGE);
  return Card({ title: "History", flush: true, footer: Row({ between: true },
      Muted(`Page ${p + 1} of ${pageCount}`),
      Row({ gap: 6 },
        Button({ size: "sm", variant: "secondary", disabled: p === 0, set: { page: p - 1 } }, "Previous"),
        Button({ size: "sm", variant: "secondary", disabled: p >= pageCount - 1, set: { page: p + 1 } }, "Next"))) },
    Table<Approval>({ id: "history", rows, rowKey: (a) => a.id, empty: html`<div style="padding:16px">${Muted("No decisions yet.")}</div>`,
      columns: [
        { label: "#", key: "id", mono: true, width: "48px" },
        { label: "Request", key: "title" },
        { label: "Outcome", width: "120px", cell: (a) => Badge({ tone: a.state === "approved" ? "ok" : "bad" }, a.state) },
      ] }));
};
```

If a filter changes, also reset the page: `set: { status: "done", page: 0 }`.

## 10. Activity feed

Stable ids on `li` make new rows flash while old ones stay put. Cap the list in the store.

```ts
const Activity = (events: { at: number; text: string }[]) =>
  events.length === 0 ? Muted("Nothing yet.")
  : html`<ul class="stack" style="--gap:6px;list-style:none;margin:0;padding:0">${events.map((e) =>
      html`<li id="ev-${e.at}" class="row sm">${Mono(new Date(e.at).toISOString().slice(11, 19))} ${e.text}</li>`)}</ul>`;
```

Use a real event id if two events can share a millisecond.

## 11. Detail view

An `open` param swaps the list for one item's detail. A Back button clears it.

```ts
view: ({ params }) => {
  const open = store.get(Number(params.open));          // undefined for a missing or junk param
  if (open) return Detail(open);
  return List(store.list(), params);
}

const Detail = (t: Task) => html`<div class="stack">
  ${Row({}, Button({ variant: "ghost", icon: "chevron", set: { open: null } }, "Back"))}
  ${Card({ title: t.title, description: t.owner }, Badge({}, t.status))}
</div>`;

// in the list, per row
Button({ variant: "ghost", size: "sm", set: { open: t.id } }, "Open")
```

For a short detail, a per-row `Dialog` (recipe 2) is simpler.

## 12. Per-user data

The view receives the MCP user. Without authentication every viewer is `"local"`.

```ts
view: ({ user }) => Card({ title: `Assigned to ${user}` }, MyTasks(store.assignedTo(user)))
```

In tool handlers, get the same id with `ui.identify(extra)`, so tools and view agree on who is asking:

```ts
server.registerTool("my_tasks", { description: "List my tasks" }, async (extra) => text(JSON.stringify(store.assignedTo(ui.identify(extra)))));
```

A tool without an `inputSchema` gets `extra` as its only argument. With one, `extra` is the second.

## 13. A view that can't throw

The view runs when a viewer syncs, not inside the agent's tool call. A view that throws breaks the UI for that viewer, but the agent's call still succeeds. Guard anything that can fail so the rest of the screen stays.

```ts
const Usage = async () => {
  try {
    const usage = await fetchUsage();
    return Stat({ label: "This month", value: usage.total });
  } catch (e) {
    console.error("[ui] usage", e);
    return Muted("Usage is unavailable right now.");
  }
};
// view: async () => html`${await Usage()} ...`
```

## 14. Custom CSS and themes

Use tokens so dark mode keeps working. `css` is unlayered and wins over the kit.

```ts
import { defineUi, themes } from "mcp-projection";

defineUi({ ..., css: `
  .lane { min-height: 120px; padding: 8px; border: 1px dashed var(--p-line-2); border-radius: var(--p-r); }
  .lane > h3 { font-size: 12px; font-weight: 500; color: var(--p-fg-3); margin-bottom: 8px; }
` });

defineUi({ ..., css: themes.terminal });                  // or themes.pop
defineUi({ ..., css: themes.terminal + `:root { --p-ok: #7bd88f }` });
```

## 15. Web mode deployments

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

**Opening the UI**: set `web.tool` and the library registers a model-visible tool for you (`web: { origin, tool: "open_tasks_in_browser" }`). For your own wording, register a new tool. Never add this to an existing tool:

```ts
server.registerTool("share_ops", { description: "Open the operations dashboard in the user's browser" }, async (extra) => {
  const r = await ui.openInBrowser(extra, { server, message: "Open the operations dashboard" });
  return text(r.opened ? "Opened in the browser." : r.declined ? "The user declined." : `Single-use link: ${r.url}`);
});
```

Without URL elicitation support in the client, the link is returned as text, so it enters the model's context. `web.tool` behaves the same way.
