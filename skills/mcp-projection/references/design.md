# Designing a projection UI

The tool list says what the system can do. The UI shows what a person needs to see and lets them do the few things that are faster by hand. Design from the person, then map to tools.

## 1. Questions to answer first

1. **Who opens it, and when?** In a host, the UI appears inline when the agent calls an `attachTo` tool: a glance in the middle of a conversation. On the web it's a tab someone keeps open: a workspace. Design for the glance first.
2. **What must they understand in five seconds?** Usually what exists, what state it's in, what just changed, and whether anything is waiting for them.
3. **What is faster by hand than by asking the agent?** Toggling, approving, correcting, deleting one item. These become actions. Everything else stays with the agent.
4. **What must a human decide?** Approvals and destructive changes. Make them explicit, with a confirm step.
5. **What would they otherwise keep asking the agent to list?** That's the main view.

## 2. Map the server onto the UI

| Server has | UI gets |
|---|---|
| Read tools (`list_*`, `get_*`, `status`, `search_*`) | Calls to the same store functions inside `view` (tools return text for a model; the view needs objects) |
| Write tools (`add_*`, `update_*`, `set_*`, `delete_*`, `run_*`) | Nothing needed for liveness: every tool call refreshes viewers. A button or form only for those a human should do by hand |
| The tool after which a person wants to look | `attachTo` (usually one: the main list or status tool) |
| Data changed outside tools (cron, webhooks, workers) | `ui.write()` at the point of change |
| UI state: search text, filters, sort, page, selection | View params, changed with `set`. Nothing on the server |
| Tools that change nothing | `annotations: { readOnlyHint: true }`, so their calls don't wake viewers |

Never add a model-visible tool or change an agent tool for the UI's sake.

Any tool a human can click is a tool the agent can call, and the other way round. The UI calls the tool through the server's own handler, so validation and defaults run. If a tool must never be run by a human, don't put a control for it in the view.

## 3. The view and its params

There is one `view`. It receives `{ user, params }` and returns the whole UI.

- **Read the store inside the view.** It runs again after every tool call, so what it reads is current. Keep it fast and make it unable to throw.
- **Params** are the per-viewer state: search text, filter, sort, page, open item. They live in the browser, are sent with each sync, and reset when the UI is reopened. Treat them as untrusted input: `String(params.q ?? "")`, clamp numbers, check against an allowed list.
- **User** is the MCP user (`authInfo.extra.sub`, or `"local"` without auth). Filter the data by it when the data is per user.
- Split the view into plain functions that return `html`: `Overview(items)`, `List(items)`. They are not registered anywhere.
- Viewers with the same user and params share one render, so a view that is expensive for one is not expensive for many.

Typical shape:

```
view
├── Header, ThemeToggle?            layout
├── Overview(items)                 Stat grid
├── List(items, params)             filtered by params, one table
├── Activity(events)                recent history
└── Dialogs                         create, confirm delete (outside the table)
```

## 4. Layout patterns

Pick one or two per screen. Code for each is in recipes.md.

| Pattern | Use it for | Built from |
|---|---|---|
| **Overview** | Counts and health | `Grid({ min: 140 })` of `Stat` with `tone`/`delta` |
| **Collection** | The main list the agent manages | `Card({ title, flush: true })` around `Table({ id, rowKey, empty })`; status as `Badge`; row actions as ghost, small, icon-only buttons with `label` |
| **Queue** | Items waiting for a human | A filtered table with Reject (secondary) and Approve (primary) per row; pending count in the card description |
| **Activity feed** | What the agent just did | `<ul>` of `<li id>` with `Mono` timestamps; newest first; capped (for example 20) |
| **Run monitor** | Long jobs | Table with `Badge` state, mono progress column, `Dot({ pulse: true })` while running; a worker calls `ui.write()`; row `Menu` for cancel |
| **Detail** | One item's full content | Per-row `Dialog`, or an `id` param that swaps the list for a detail view with a Back button |
| **Settings** | A few values the agent reads | `Card` with `Checkbox({ switch: true, tool })` and `Select({ tool })` in a `Grid` |
| **Views of one dataset** | All / Pinned / Mine | `Tabs` with one panel each, or a filter param with `Select` |

Screen order: header, what needs the person (queue), status (overview, runs), the full collection, history and settings.

## 5. Visual rules

The kit is hairline, monochrome and dense. Stay inside it.

- **Colour means state.** Tones only for status (`ok`, `warn`, `bad`, `info`), never for decoration.
- **One primary button per view.** Others are `secondary` or `ghost`; destructive confirms are `danger`.
- **Small controls in tables**: `size: "sm"`, `variant: "ghost"`, icon-only with a `label`.
- **Right-align row actions** with `` html`<div class="row" style="--gap:6px;justify-content:flex-end">...</div>` `` (a flex row ignores the column's `align: "right"`).
- **Numbers and ids** in `Mono` or `mono: true` columns, right-aligned when they're quantities.
- **Empty states say how to fill them**: "No tasks yet. Ask your assistant to add one."
- **Say it's live** where people might doubt it: `Dot({ tone: "ok", pulse: true, label: "Live" })` + "Shared with your assistant".
- **Constrain width**: wrap the view in `<div class="stack" style="--gap:20px;max-width:960px;margin:0 auto">`.
- **Work at 420 px.** Hosts often show the UI in a narrow column. `Grid` and `Row` wrap; tables scroll. Keep at most four or five table columns; fold secondary fields under the title with `Stack({ gap: 2 }, title, Muted(sub))`.
- **Sentence case, short labels.** Button labels are verbs ("Approve", "New task").
- **Confirm destructive actions** with a dialog that names the item and says the agent will see the change.

## 6. Accessibility

- Icon-only buttons and dots need `label`.
- Use real controls (`Button`, `Select`, `Checkbox`), not clickable `div`s.
- Dialogs have a title; forms have labels (`Input({ label })`) or a placeholder only for single search fields.
- Don't convey state by colour alone: `Badge` text says the state.

## 7. Review the result

After previewing, check:

- Can someone tell what needs them within five seconds?
- Is there exactly one primary button in each view?
- Do empty states, long titles and 420 px width look right?
- Does dark mode keep contrast (no hard-coded colours)?
- Does every action that destroys or approves something have a confirm or an explicit button?
