# Views and actions

How to write the view, build HTML safely, use the components, and let a person change things. Exact props are in the [reference](reference.md).

## The view

There is one `view`. It receives `{ user, params }` and returns the whole UI as `html`.

```ts
view: async ({ user, params }) => html`...`
```

- **It runs again** after every tool call (except `p_sync` and `readOnlyHint` tools) and after `ui.write()`. Reading the store inside it keeps it current.
- **`user`** is the MCP user: `authInfo.extra.sub`, or `"local"` with no auth. Filter per-user data by it. See [Users and security](users-and-security.md).
- **`params`** is per-viewer state: search text, filter, page, open item. It lives in the browser, goes up with each sync, and resets when the UI is reopened. It starts as `{}`.
- **Params are untrusted.** Any value can be any JSON type. Read them defensively: `String(params.q ?? "")`, clamp numbers, check against an allowed list.
- **The view must return `html`.** Anything else throws `` view must return html`...`. ``.
- **Make it unable to throw.** A throwing view fails only that viewer's sync, not agent calls, but the person sees nothing. Wrap data reads you don't control in `try`/`catch` and render a message.
- Split a big view into plain functions that return `html`. They are not registered anywhere.

Typical shape:

```
view
├── Header, ThemeToggle?       layout
├── Stats(items)               Stat grid
├── List(items, params)        filtered by params, one table
├── Activity(events)           recent history
└── Dialogs                    create, confirm delete (outside the table is fine; inside a cell works too)
```

## Writing HTML

`html` is a tagged template. It escapes every interpolated value.

```ts
import { html, raw } from "mcp-projection";

html`<li>${note.title}</li>`                     // title is escaped
html`<ul>${notes.map((n) => html`<li>${n.title}</li>`)}</ul>`   // arrays of html are inlined
html`${count > 0 && html`<b>${count}</b>`}`      // false renders nothing; 0 renders "0"
```

- Numbers render, including `0`. `null`, `undefined`, `true` and `false` render nothing. That is why `` ${n && html`...`} `` prints `0` when `n` is `0`. Use `${n > 0 && ...}`.
- A string of HTML is escaped on purpose. Build markup with `html`. Use `raw(s)` only for HTML you produced and trust.
- Check URL schemes before rendering user-supplied links.
- Other helpers: `esc(v)` escapes to a string, `attrs(obj)` renders attributes, `cx(...)` joins class names.
- `<script>` in the output does not run. There is no client JavaScript besides the runtime.

Give every repeating element a stable, page-unique `id` (`<li id="ev-${e.id}">`). The morph matches by id, so new rows slide in and old ones stay put. Without ids, a whole list re-morphs and flashes.

## Components

All components return `html` and take children as extra arguments. They can be used anywhere in the view, including inside table cells.

- **Layout:** `Stack`, `Row`, `Grid`, `Separator`, `Header`, `Card`.
- **Controls:** `Button`, `Form`, `Input`, `Textarea`, `Select`, `Checkbox`.
- **Display:** `Badge`, `Dot`, `Kbd`, `Muted`, `Mono`, `Stat`, `Table`, `Empty`, `Skeleton`, `Icon`.
- **Overlays and tabs:** `Tabs`, `Dialog`, `Close`, `Menu`, `ThemeToggle`.

Every prop is in the [reference](reference.md#components). Notes that save time:

- A `Table` needs `rowKey` and an `id` so rows keep their identity. Two tables on one page need different `id`s.
- `Table` `align: "right"` aligns text. To right-align buttons, wrap them in `` html`<div class="row" style="justify-content:flex-end">...</div>` ``.
- Pass `actions: cond ? x : undefined`, not `cond && x`.
- A `Dialog` opens with `Button({ opens: id })`. Put its buttons in `` html`<div class="actions">...</div>` ``.
- `Tabs` takes up to six tabs and keeps the selected tab in the browser.

## Actions

### The action props

`Button`, `Form`, `Input`, `Textarea`, `Select`, `Checkbox` and menu items take these props:

| Prop | Meaning |
|---|---|
| `tool` | Call this tool |
| `args` | Extra arguments, merged last. They keep JSON types |
| `set` | Instead of a tool: merge values into the view params and render again. `true` on an `Input`, `Select` or `Form` sets its own fields |
| `close` | Close the surrounding dialog or menu on success |

The default trigger is `submit` for forms, `change` for inputs, selects and checkboxes, and `click` for buttons. `Input` with `debounce` acts while typing.

### What the handler receives

The call goes through the server's own `tools/call` handler. That means:

- **Validation runs.** zod checks the input, applies defaults and coerces where you asked it to. The UI has no way around your schema.
- **Form values are text.** A text field arrives as a string, a checkbox as a boolean. For a number, use `z.coerce.number()` in the schema, or pass it in `args`, where it keeps its JSON type.
- **Failures show on the control.** A thrown error, a zod rejection or a result with `isError: true` shows as `p-error` with the message, and the control goes back to what the server last rendered. You don't need a second tool to report failures.
- **Output schemas are checked** like any other call.

```ts
Select({ name: "status", value: t.status, options: ["todo", "doing", "done"], tool: "set_status", args: { id: t.id } })
// handler gets { id: 7, status: "doing" }: id from args (a number), status from the select (a string)
```

Any tool a human can click is a tool the agent can call, and the other way round. Put controls only on tools a human should run.

### View state needs no tools

Search text, filters, pages and the open item are view params. A `set` control changes them, and nothing is called on the server:

```ts
Input({ name: "q", set: true, debounce: 250, value: String(params.q ?? "") })
Button({ set: { page: 2 } }, "Next")
Button({ set: { open: t.id } }, "Details")
Button({ set: { open: null } }, "Back")
```

Use a param for anything only this viewer should see change. Use a tool for anything the agent should see. Older designs used app-only `ui_*` tools to hold this state on the server; that is gone.

### Confirm destructive actions

Open a dialog from a button, and put the real action behind a form inside it:

```ts
Button({ variant: "ghost", size: "sm", icon: "trash", label: "Delete", opens: `del-${t.id}` }),
Dialog({ id: `del-${t.id}`, title: "Delete task?" },
  Form({ tool: "delete_task", args: { id: t.id }, close: true },
    html`<div class="actions">${Close(`del-${t.id}`)}${Button({ type: "submit", variant: "danger" }, "Delete")}</div>`))
```

### Forms

A `Form` sends all its named fields, then `args`. It resets on success unless `keepValues` is set, and `close: true` closes the dialog it sits in.

More patterns (approval queues, filters and tabs, pagination, detail views, settings) are in the [recipes](../skills/mcp-projection/references/recipes.md).
