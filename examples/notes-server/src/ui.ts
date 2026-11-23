import { defineUi, html, Header, Button, Badge, Dot, Stat, Grid, Table, Tabs, Dialog, Form, Input, Textarea, Close, Empty, Stack, Row, Card, Muted } from "mcp-projection";
import { store, type Note } from "./store.js";

export const ui = defineUi({
  name: "notes",
  load: { notes: () => store.list() },
  writes: { add_note: ["notes"], pin_note: ["notes"] },
  attachTo: ["list_notes"],
  web: { origin: process.env.UI_ORIGIN ?? "http://localhost:3000", tool: "open_notes_in_browser" },
});

ui.fragment("app", async ({ frag }) => html`
  <div class="stack" style="--gap:20px;max-width:880px;margin:0 auto">
    ${Header({
      title: "Notes",
      description: html`<span class="row" style="--gap:6px">${Dot({ tone: "ok", pulse: true, label: "Live" })} Live, shared with your assistant</span>`,
      actions: Button({ opens: "new-note", icon: "plus" }, "New note"),
    })}
    ${await frag("stats")}
    ${Card({ flush: true }, html`<div style="padding:4px 16px 0">${Tabs({ id: "view", tabs: [
      { label: "All", content: await frag("list") },
      { label: "Pinned", content: await frag("list", { filter: "pinned" }) },
    ] })}</div>`)}
    ${Dialog({ id: "new-note", title: "New note", description: "Your assistant will see it straight away." },
      Form({ tool: "add_note", close: true },
        Input({ name: "title", label: "Title", required: true, placeholder: "Ship the UI layer" }),
        Textarea({ name: "body", label: "Body", placeholder: "Optional", rows: 3 }),
        html`<div class="actions">${Close("new-note")}${Button({ type: "submit" }, "Create")}</div>`))}
  </div>`);

ui.fragment("stats", async ({ read }) => {
  const notes = await read("notes");
  const pinned = notes.filter((n) => n.pinned).length;
  return Grid({ min: 160 },
    Stat({ label: "Notes", value: notes.length }),
    Stat({ label: "Pinned", value: pinned }),
    Stat({ label: "Unpinned", value: notes.length - pinned }));
});

ui.fragment("list", async ({ read, params }) => {
  const notes = (await read("notes")).filter((n) => params.filter !== "pinned" || n.pinned);
  return Table<Note>({
    id: `notes-${params.filter ?? "all"}`, rows: notes, rowKey: (n) => n.id,
    empty: html`<div style="padding:16px 0">${Empty({ title: params.filter ? "Nothing pinned" : "No notes yet",
      description: "Ask your assistant to add one, or create it here.", action: Button({ opens: "new-note", variant: "secondary", size: "sm" }, "New note") })}</div>`,
    columns: [
      { label: "#", cell: (n) => n.id, mono: true, width: "48px" },
      { label: "Note", cell: (n) => Stack({ gap: 2 }, html`<strong style="font-weight:500">${n.title}</strong>`, n.body && Muted(n.body)) },
      { label: "Status", cell: (n) => n.pinned ? Badge({ tone: "info", dot: true }, "Pinned") : Badge({}, "Note"), width: "110px" },
      { label: "", align: "right", width: "56px", cell: (n) =>
        Button({ variant: "ghost", size: "sm", icon: "pin", label: n.pinned ? "Unpin" : "Pin", tool: "pin_note", args: { id: n.id } }) },
    ],
  });
});
