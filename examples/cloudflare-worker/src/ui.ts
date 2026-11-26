import { env } from "cloudflare:workers";
import { handleMcp } from "./server.js";
import { defineUi, themes, ThemeToggle, html, Header, Button, Badge, Dot, Stat, Grid, Table, Tabs, Dialog, Form, Input, Textarea, Close, Empty, Card } from "mcp-projector";

type Note = { id: number; title: string; pinned: boolean };

// list_notes is annotated readOnlyHint in server.ts, so the view may call it. The view reads only through the server's own tools. list_notes returns text for the model ("#1 (pinned) Title"),
// so the UI reads that text back. A tool that returned structuredContent could be used as it is.
const notesFrom = (r: any): Note[] => String(r.content?.[0]?.text ?? "").split("\n").flatMap((line) => {
  const m = /^#(\d+)( \(pinned\))? (.*)$/.exec(line);
  return m ? [{ id: Number(m[1]), pinned: !!m[2], title: m[3] }] : [];
});

export const ui = defineUi({
  name: "notes",
  attachTo: ["list_notes"],
  css: themes.terminal,
  web: {
    origin: env.UI_ORIGIN, // required on a deploy, with the secret; `wrangler dev` passes both
    secret: env.UI_SECRET,
    // A link is single use: the insert succeeds only the first time, whichever isolate runs it.
    claim: async (id, exp) => {
      await env.DB.prepare("DELETE FROM used_links WHERE exp < ?").bind(Date.now()).run();
      return (await env.DB.prepare("INSERT OR IGNORE INTO used_links (id, exp) VALUES (?, ?)").bind(id, exp).run()).meta.changes === 1;
    },
    mcp: (req) => handleMcp(req), // the browser's calls go to this Worker's own /mcp in-process, with the agent's bearer token (a Worker fetching its own URL is unreliable)
  },
  view: async ({ call, params }) => {
    const q = String(params.q ?? "").toLowerCase();
    const notes = notesFrom(await call("list_notes")).filter((n) => n.title.toLowerCase().includes(q));
    const pinned = notes.filter((n) => n.pinned);
    return html`
      <div class="stack" style="--gap:20px;max-width:880px;margin:0 auto">
        ${Header({
          title: "Notes",
          description: html`<span class="row" style="--gap:6px">${Dot({ tone: "ok", pulse: true, label: "Live" })} Live, shared with your assistant</span>`,
          actions: [ThemeToggle(), Button({ opens: "new-note", icon: "plus" }, "New note")],
        })}
        ${Grid({ min: 160 },
          Stat({ label: "Notes", value: notes.length }),
          Stat({ label: "Pinned", value: pinned.length }),
          Stat({ label: "Unpinned", value: notes.length - pinned.length }))}
        ${Input({ name: "q", set: true, debounce: 150, placeholder: "Search notes" })}
        ${Card({ flush: true }, html`<div style="padding:4px 16px 0">${Tabs({ id: "view", tabs: [
          { label: "All", content: List("all", notes) },
          { label: "Pinned", content: List("pinned", pinned) },
        ] })}</div>`)}
        ${Dialog({ id: "new-note", title: "New note", description: "Your assistant will see it straight away." },
          Form({ tool: "add_note", close: true },
            Input({ name: "title", label: "Title", required: true, placeholder: "Ship the UI layer" }),
            Textarea({ name: "body", label: "Body", placeholder: "Optional", rows: 3 }),
            html`<div class="actions">${Close("new-note")}${Button({ type: "submit" }, "Create")}</div>`))}
      </div>`;
  },
});

const List = (id: "all" | "pinned", notes: Note[]) => Table<Note>({
  id: `notes-${id}`, rows: notes, rowKey: (n) => n.id,
  empty: html`<div style="padding:16px 0">${Empty({ title: id === "pinned" ? "Nothing pinned" : "No notes yet",
    description: "Ask your assistant to add one, or create it here.", action: Button({ opens: "new-note", variant: "secondary", size: "sm" }, "New note") })}</div>`,
  columns: [
    { label: "#", cell: (n) => n.id, mono: true, width: "48px" },
    { label: "Note", cell: (n) => html`<strong style="font-weight:500">${n.title}</strong>` },
    { label: "Status", cell: (n) => n.pinned ? Badge({ tone: "info", dot: true }, "Pinned") : Badge({}, "Note"), width: "110px" },
    { label: "", align: "right", width: "56px", cell: (n) =>
      Button({ variant: "ghost", size: "sm", icon: "pin", label: n.pinned ? "Unpin" : "Pin", tool: "pin_note", args: { id: n.id } }) },
  ],
});
