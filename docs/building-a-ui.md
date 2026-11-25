# Building a UI

What to know once the first view works.

## Decide what to show

Start from the person, not the tool list. Ask what they need to understand in five seconds (usually what exists, what state it's in and what changed), and what is faster to do by hand than by asking the agent. Those few things become buttons. Everything else stays with the agent.

Pick one tool for `attachTo`, usually the main list or status tool. It only matters to apps that support MCP Apps, which projection hasn't been tested in.

## The view

```ts
view: ({ user, params }) => html`...`
```

- It runs again after every tool call and every `ui.write()`, so read your store inside it.
- `user` is who is viewing (see [Users](#users)). Filter per-user data by it.
- `params` is what this viewer is looking at: search text, page, open row. It lives in their browser and starts as `{}`.
- Params can be anything, so read them carefully: `String(params.q ?? "")`.
- Return `html`, and don't let the view throw. A throwing view shows that viewer nothing.
- Split a big view into plain functions that return `html`.

## Components

Each component is a function that returns `html`. Children go in as extra arguments: `Card({ title: "Tasks" }, Table(...))`. Hover one in your editor for its props, or read [`components.ts`](../src/ui/components.ts).

| Kind | Components | Use them for |
|---|---|---|
| Layout | `Stack`, `Row`, `Grid`, `Card`, `Header`, `Separator` | Arranging the page. `Grid` of `Stat` for an overview; `Card({ flush: true })` around a table |
| Data | `Table`, `Stat`, `Badge`, `Dot`, `Empty`, `Skeleton` | Lists, counts, status and empty states |
| Controls | `Button`, `Form`, `Input`, `Textarea`, `Select`, `Checkbox` | Calling tools (`tool`) or changing params (`set`) |
| Overlays | `Dialog`, `Close`, `Menu`, `Tabs` | Confirms, create forms, row menus, switching views. All work without JavaScript |
| Text | `Muted`, `Mono`, `Kbd`, `Icon` | Quieter text, ids and numbers, shortcuts, icons |
| Theme | `ThemeToggle` | Letting the viewer pick light or dark outside a host |

## Writing HTML

`html` escapes every value you put in it. Arrays of `html` are joined.

```ts
html`<ul>${notes.map((n) => html`<li id="note-${n.id}">${n.title}</li>`)}</ul>`
```

- Give anything that repeats a stable `id`. Rows then update in place instead of the whole list flashing. A `Table` needs `id` and `rowKey`.
- `0` renders, but `false`, `null` and `undefined` don't. So write `${n > 0 && ...}`, not `${n && ...}`.
- A string of HTML is escaped on purpose. Use `raw()` only for HTML you made yourself.
- `<script>` never runs. Use components, `<details>`, dialogs and params instead.

## Actions

Controls take `tool` and `args` to call a tool, or `set` to change params without calling anything:

```ts
Button({ tool: "pin_note", args: { id: n.id } }, "Pin")
Select({ name: "status", value: t.status, options: ["todo", "done"], tool: "set_status", args: { id: t.id } })
Input({ name: "q", set: true, debounce: 250, placeholder: "Search" })   // search: no tool needed
Button({ set: { page: 2 } }, "Next")
```

- **Form values arrive as text.** Inputs and selects send strings, and checkboxes send booleans. Values in `args` keep their type, so put ids and numbers there.
- **Errors show on the control.** If the handler throws, returns `isError` or fails validation, the message appears next to the control.
- **Confirm before destroying.** Open a `Dialog` from a button with `opens`, and put the real action in a `Form` inside it.
- **Any tool you give a button to can be called by anyone who can open the UI,** with any arguments the schema accepts.

## Live updates

Every tool call refreshes the UI, except tools marked `readOnlyHint: true`, which change nothing. If data changes somewhere else (a cron job, a webhook, a worker), call `ui.write()` there.

## Users

Projection has no sign-in. The user comes from MCP auth: `authInfo.extra.sub`, or `"local"` when there is no auth, in which case every viewer is the same user. In your tool handlers, use `ui.identify(extra)` to get the same id the view sees. To map identity differently, pass `identify` to `defineUi`.

## Styling

The UI follows the host's light or dark theme. To change the look, pass `css`: it always wins over the built-in styles.

```ts
defineUi({ ..., css: ":root { --p-r: 6px }" });   // tweak a token
defineUi({ ..., css: themes.terminal });          // or themes.pop
```

Use the `--p-*` tokens rather than fixed colours so both themes keep working. Tokens are listed in [`tokens.css`](../src/ui/tokens.css).

A few rules that keep it readable:

- Colour means state. Use tones for status only.
- One primary button per view.
- Small ghost icon buttons in table rows, each with a `label`.
- Empty states say how to fill them: "No tasks yet. Ask your assistant to add one."
- Check it at 420 px wide, for narrow windows.

## More

- Patterns for queues, filters, paging, detail views and settings: [recipes](../skills/mcp-projection/references/recipes.md).
- When something goes wrong: [troubleshooting](../skills/mcp-projection/references/troubleshooting.md).
- Every component's props: the types in [`components.ts`](../src/ui/components.ts).
