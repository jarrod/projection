# Worked example: a tasks server

An agent-first task tracker with the tools `list_tasks`, `add_task`, `set_status` and `delete_task`. By the end, a person can see counts, search the list, change a task's status, delete one with confirmation, add one, and watch an activity feed of what the agent did. Every block of code here compiles under `tsc --strict` and the test at the end passes against the current library.

Read [Getting started](getting-started.md) first if you haven't installed projection.

## 1. Plan

Answer the [design questions](design.md#1-questions-to-answer-first) before writing code:

- **Person and moment:** a teammate checking on the agent's work. The UI opens when the agent lists tasks, so `attachTo: ["list_tasks"]`.
- **At a glance:** how many tasks are in each state, and what just changed.
- **View params:** `q`, the search text.
- **Actions:** change status (a select), delete (a confirm dialog), add a task (a dialog form), search (`set`, no tool).

## 2. The store and the server

The store is plain data with an activity log. Nothing in it knows about the UI.

**`src/store.ts`**

```ts
export type Status = "todo" | "doing" | "done";
export type Task = { id: number; title: string; status: Status; owner: string };
export type Event = { id: number; at: number; text: string };

let tasks: Task[] = [], events: Event[] = [], nextTask = 1, nextEvent = 1;

export const store = {
  list: () => tasks,
  events: () => events.slice(-20).reverse(),
  log(text: string) { events.push({ id: nextEvent++, at: Date.now(), text }); },
  add(title: string, owner: string) {
    const t: Task = { id: nextTask++, title, status: "todo", owner };
    tasks.push(t); this.log(`${owner} added "${title}"`); return t;
  },
  setStatus(id: number, status: Status) {
    const t = tasks.find((t) => t.id === id);
    if (!t) throw new Error(`No task ${id}`);
    t.status = status; this.log(`Task ${id} is now ${status}`); return t;
  },
  remove(id: number) {
    const t = tasks.find((t) => t.id === id);
    if (!t) throw new Error(`No task ${id}`);
    tasks = tasks.filter((x) => x !== t); this.log(`Task ${id} was deleted`);
  },
};
```

The server is what you already have, with one change: `ui.attach(...)` around the constructor.

**`src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { store } from "./store.js";
import { ui } from "./ui.js";

export function createServer() {
  const server = ui.attach(new McpServer({ name: "tasks", version: "1.0.0" }));
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

  server.registerTool("list_tasks", {
    description: "List all tasks",
    annotations: { readOnlyHint: true },
  }, async () => text(JSON.stringify(store.list())));

  server.registerTool("add_task", {
    description: "Add a task",
    inputSchema: { title: z.string().min(1), owner: z.string().default("agent") },
  }, async ({ title, owner }) => text(JSON.stringify(store.add(title, owner))));

  server.registerTool("set_status", {
    description: "Set a task's status",
    inputSchema: { id: z.number(), status: z.enum(["todo", "doing", "done"]) },
  }, async ({ id, status }) => text(JSON.stringify(store.setStatus(id, status))));

  server.registerTool("delete_task", {
    description: "Delete a task",
    inputSchema: { id: z.number() },
  }, async ({ id }) => { store.remove(id); return text("deleted"); });

  return server;
}
```

`list_tasks` is `readOnlyHint`, so the agent listing tasks doesn't wake every viewer.

## 3. The view, part by part

All of `src/ui.ts` follows, in order. Each part is a plain function or a slice of the view.

### The page

The view reads `q` defensively, filters the store, and lays out the page: a header with a live dot and a New task button, three stats, the task list in a card with a search box, the activity feed, and the dialog the New task button opens.

**`src/ui.ts`**

```ts
import { defineUi, html, Header, Button, Stat, Grid, Table, Dialog, Form, Input, Select, Close, Empty, Card, Stack, Muted, Mono, Dot } from "mcp-projection";
import { store, type Task } from "./store.js";

export const ui = defineUi({
  name: "tasks",
  attachTo: ["list_tasks"],
  view: ({ params }) => {
    const q = String(params.q ?? "");
    const all = store.list();
    const tasks = q ? all.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())) : all;
    const count = (s: string) => all.filter((t) => t.status === s).length;
    return html`
      <div class="stack" style="--gap:20px;max-width:960px;margin:0 auto">
        ${Header({
          title: "Tasks",
          description: html`<span class="row" style="--gap:6px">${Dot({ tone: "ok", pulse: true, label: "Live" })} Shared with your assistant</span>`,
          actions: Button({ opens: "new-task", icon: "plus" }, "New task"),
        })}
        ${Grid({ min: 140 },
          Stat({ label: "To do", value: count("todo") }),
          Stat({ label: "Doing", value: count("doing"), tone: "info" }),
          Stat({ label: "Done", value: count("done"), tone: "ok" }))}
        ${Card({ title: "All tasks", flush: true, actions: Input({ name: "q", set: true, debounce: 250, placeholder: "Search", value: q }) },
          List(tasks, q))}
        ${Card({ title: "Activity" }, Activity())}
        ${Dialog({ id: "new-task", title: "New task", description: "Your assistant sees it straight away." },
          Form({ tool: "add_task", args: { owner: "you" }, close: true },
            Input({ name: "title", label: "Title", required: true }),
            html`<div class="actions">${Close("new-task")}${Button({ type: "submit" }, "Create")}</div>`))}
      </div>`;
  },
});
```

- Search is a param set by the input. There is no server-side search state and no extra tool.
- The new-task form sends `owner` through `args`. The schema's default would also work, because validation runs, but `"you"` says who made the task.

### The list

A table with a stable `id` and `rowKey`, so rows keep their identity across updates. The status column is a select that calls `set_status`. The last column opens a per-row confirm dialog.

```ts
const List = (rows: Task[], q: string) => Table<Task>({
  id: "tasks", rows, rowKey: (t) => t.id,
  empty: html`<div style="padding:16px">${Empty({ title: q ? `Nothing matches "${q}"` : "No tasks yet", description: "Ask your assistant to add one." })}</div>`,
  columns: [
    { label: "#", cell: (t) => t.id, mono: true, width: "48px" },
    { label: "Task", cell: (t) => Stack({ gap: 2 }, html`<strong style="font-weight:500">${t.title}</strong>`, Muted(t.owner)) },
    { label: "Status", width: "140px", cell: (t) =>
      Select({ name: "status", value: t.status, options: ["todo", "doing", "done"], tool: "set_status", args: { id: t.id } }) },
    { label: "", align: "right", width: "56px", cell: (t) => html`
      ${Button({ variant: "ghost", size: "sm", icon: "trash", label: `Delete task ${t.id}`, opens: `del-${t.id}` })}
      ${Dialog({ id: `del-${t.id}`, title: "Delete task?", description: html`"${t.title}" will be removed for you and your assistant.` },
        Form({ tool: "delete_task", args: { id: t.id }, close: true },
          html`<div class="actions">${Close(`del-${t.id}`)}${Button({ type: "submit", variant: "danger" }, "Delete")}</div>`))}` },
  ],
});
```

- `set_status` gets `id` from `args` (a number) and `status` from the select (a string limited by the select's options). The schema's `z.number()` would reject a string id, so the id must travel in `args`.
- A failure, for example deleting a task that is already gone, throws in the handler and shows as `p-error` on the form. No second tool is needed to report it.

### The activity feed

```ts
const Activity = () => {
  const events = store.events();
  if (events.length === 0) return Muted("Nothing yet.");
  return html`<ul class="stack" style="--gap:6px;list-style:none;margin:0;padding:0">${events.map((e) =>
    html`<li id="ev-${e.id}" class="row sm">${Mono(new Date(e.at).toISOString().slice(11, 19))} ${e.text}</li>`)}</ul>`;
};
```

Each row has an id from an incrementing event counter, so new rows slide in and flash while old ones stay put.

## 4. Changes outside a tool

A nightly sync finishes and logs an event. No tool ran, so tell the UI:

```ts
store.log("Nightly sync finished");
ui.write();
```

## 5. Test

```js
import assert from "node:assert/strict";
import { testUi } from "mcp-projection/testing";
import { createServer } from "./dist/server.js";

const t = await testUi(createServer);
assert.ok(t.resourceUri);
assert.ok(!t.modelTools.some((x) => x.name === "p_sync"));
const v = await t.mount();
await t.agent.callTool({ name: "add_task", arguments: { title: "Write skill" } });
await v.until((_, html) => html.includes('id="tasks-1"'));
await v.click("set_status", { id: 1, status: "doing" });
await v.until((text) => text.includes("Task 1 is now doing"));
await v.set({ q: "nomatch" });
await v.until((text) => text.includes('Nothing matches "nomatch"'));
await assert.rejects(v.click("set_status", { id: 99, status: "done" }));   // handler throws
await assert.rejects(v.click("set_status", { id: "1", status: "done" }));  // zod rejects a string id
v.close(); await t.close(); process.exit();
```

The test covers an agent write showing up live, a human action, a param change, a handler error and a validation error. [Testing](testing.md) covers previews and the snapshot check.
