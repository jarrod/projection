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
| Read tools (`list_*`, `get_*`, `status`, `search_*`) | Loaders that call the same store functions directly (tools return text for a model; loaders return objects for HTML) |
| Write tools (`add_*`, `update_*`, `set_*`, `delete_*`, `run_*`) | A `writes` entry for **every** one, so agent calls refresh the UI. A button or form only for those a human should do by hand |
| The tool after which a person wants to look | `attachTo` (usually one: the main list or status tool) |
| Data changed outside tools (cron, webhooks, workers) | `ui.write(key)` at the point of change |
| UI state: search text, filters, sort, page, selection | App-only `ui_*` tools plus a per-user `view` key |
| An agent tool that reports failure with `isError` that a person needs to see | An app-only twin that calls the same core function and throws |

Never add a model-visible tool or change an agent tool for the UI's sake.

Tools the UI never calls still belong in `writes` if they change data the UI shows. `writes` is both "what refreshes the UI" and "what the UI may call", so a tool that's in `writes` only for refreshing is also callable by the UI. If a write tool must never be run by a human, consider whether the UI should show its data at all, or refresh via `ui.write` from inside the store layer instead.

## 3. Data keys

- **Collection key** per thing that changes together: `notes`, `tasks`, `runs`. The default.
- **Item key** for per-item fragments: `task: ({ id }) => store.get(Number(id))`, read as `read("task", id)`. `ui.write("task:7")` refreshes only readers of task 7.
- **Per-user key**: loaders get `{ user }`. Without authentication everyone is `"local"`.
- **View key** for UI state set by app-only tools: `view: ({ user }) => views.get(user) ?? defaults`.

Loaders run inside the agent's tool call that triggered the write. Keep them fast, and make them unable to throw.

## 4. Fragments

Rules:

1. **Root fragment reads nothing.** It holds layout, dialogs and `frag()` calls, so it never re-renders.
2. **Leaves read only what they show**, one leaf per region that changes independently.
3. A fragment re-renders **with all its children** and sends its whole HTML. Keep heavy regions in their own leaf.
4. **No fragment boundary inside `<table>`, `<tbody>`, `<tr>` or `<select>`.** Use a whole-table fragment, or a list/grid for per-item fragments.
5. **Never mount the same fragment with the same params twice** on one page.
6. Use params for variants: `frag("list", { filter: "pinned" })`.

Typical tree:

```
app                 reads nothing: Header, Dialogs, layout
├── stats           reads tasks
├── list            reads tasks, view
└── activity        reads events
```

## 5. Layout patterns

Pick one or two per screen. Code for each is in recipes.md.

| Pattern | Use it for | Built from |
|---|---|---|
| **Overview** | Counts and health | `Grid({ min: 140 })` of `Stat` with `tone`/`delta` |
| **Collection** | The main list the agent manages | `Card({ title, flush: true })` around `Table({ id, rowKey, empty })`; status as `Badge`; row actions as ghost, small, icon-only buttons with `label` |
| **Queue** | Items waiting for a human | A filtered table with Reject (secondary) and Approve (primary) per row; pending count in the card description |
| **Activity feed** | What the agent just did | `<ul>` of `<li id>` with `Mono` timestamps; newest first; capped (for example 20) |
| **Run monitor** | Long jobs | Table with `Badge` state, mono progress column, `Dot({ pulse: true })` while running; a worker calls `ui.write("runs")`; row `Menu` for cancel |
| **Detail** | One item's full content | Per-row `Dialog`, or an item-key fragment |
| **Settings** | A few values the agent reads | `Card` with `Checkbox({ switch: true, tool })` and `Select({ tool })` in a `Grid` |
| **Views of one dataset** | All / Pinned / Mine | `Tabs` whose panels are `frag("list", { filter })` |

Screen order: header → what needs the person (queue) → status (overview, runs) → the full collection → history and settings.

## 6. Visual rules

The kit is hairline, monochrome and dense. Stay inside it.

- **Colour means state.** Tones only for status (`ok`, `warn`, `bad`, `info`), never for decoration.
- **One primary button per view.** Others are `secondary` or `ghost`; destructive confirms are `danger`.
- **Small controls in tables**: `size: "sm"`, `variant: "ghost"`, icon-only with a `label`.
- **Right-align row actions** with `` html`<div class="row" style="--gap:6px;justify-content:flex-end">...</div>` `` (a flex row ignores the column's `align: "right"`).
- **Numbers and ids** in `Mono` or `mono: true` columns, right-aligned when they're quantities.
- **Empty states say how to fill them**: "No tasks yet. Ask your assistant to add one."
- **Say it's live** where people might doubt it: `Dot({ tone: "ok", pulse: true, label: "Live" })` + "Shared with your assistant".
- **Constrain width**: wrap the root in `<div class="stack" style="--gap:20px;max-width:960px;margin:0 auto">`.
- **Work at 420 px.** Hosts often show the UI in a narrow column. `Grid` and `Row` wrap; tables scroll. Keep at most four or five table columns; fold secondary fields under the title with `Stack({ gap: 2 }, title, Muted(sub))`.
- **Sentence case, short labels.** Button labels are verbs ("Approve", "New task").
- **Confirm destructive actions** with a dialog that names the item and says the agent will see the change.

## 7. Accessibility

- Icon-only buttons and dots need `label`.
- Use real controls (`Button`, `Select`, `Checkbox`), not clickable `div`s.
- Dialogs have a title; forms have labels (`Input({ label })`) or a placeholder only for single search fields.
- Don't convey state by colour alone: `Badge` text says the state.

## 8. Review the result

After previewing, check:

- Can someone tell what needs them within five seconds?
- Is there exactly one primary button in each view?
- Do empty states, long titles and 420 px width look right?
- Does dark mode keep contrast (no hard-coded colours)?
- Does every action that destroys or approves something have a confirm or an explicit button?
