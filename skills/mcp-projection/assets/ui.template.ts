// src/ui.ts: the whole human UI for this MCP server. Keep all UI code in this file.
// Replace every TODO, then delete the comments you don't need.
import { defineUi, html, Header, Badge, Dot, Stat, Grid, Table, Card, Empty, Muted, Stack, Input } from "mcp-projection"; // add Button, Dialog, Form... as needed
import { store, type Item } from "./store.js"; // TODO: the module your tools already use for data

export const ui = defineUi({
  name: "items", // TODO: short name; the resource becomes ui://items/app.html
  // Tools after which a person wants to look (usually the main read tool).
  attachTo: [/* "list_items" */],
  // Optional: serve on a URL too. `tool` adds ONE model-visible tool; leave it out unless wanted.
  // web: { origin: process.env.UI_ORIGIN ?? "http://localhost:3000", tool: "open_items_in_browser" },

  // The whole UI: a function of who is viewing and what they have set (params).
  // It runs again after every tool call. Read data the way your tools do, scoped to `user`.
  view: ({ user, params }) => {
    const q = String(params.q ?? "").toLowerCase(); // params are untrusted: read them defensively
    const all = store.list(user); // TODO: in tool handlers use ui.identify(extra) so tools and view agree on the user
    const items = all.filter((i) => i.title.toLowerCase().includes(q));
    return html`
      <div class="stack" style="--gap:20px;max-width:960px;margin:0 auto">
        ${Header({
          title: "Items", // TODO
          description: html`<span class="row" style="--gap:6px">${Dot({ tone: "ok", pulse: true, label: "Live" })} Shared with your assistant</span>`,
        })}
        ${Grid({ min: 140 }, Stat({ label: "Items", value: all.length }))}
        ${Input({ name: "q", set: true, debounce: 150, placeholder: "Search" })}
        ${Card({ flush: true }, List(items))}
      </div>`;
  },
});

// Split a big view into plain functions that return html. There is nothing to register.
const List = (items: Item[]) => Table<Item>({
  id: "items", rows: items, rowKey: (i) => i.id, // stable, page-unique row ids
  empty: html`<div style="padding:16px">${Empty({ title: "No items yet", description: "Ask your assistant to add one." })}</div>`,
  columns: [
    { label: "#", cell: (i) => i.id, mono: true, width: "48px" },
    { label: "Item", cell: (i) => Stack({ gap: 2 }, html`<strong style="font-weight:500">${i.title}</strong>`, Muted(i.owner)) },
    { label: "Status", width: "120px", cell: (i) => Badge({ tone: i.done ? "ok" : "neutral", dot: true }, i.done ? "Done" : "Open") },
    // Row action (import Button). It makes the same tools/call the agent makes. Numbers go in args.
    // { label: "", align: "right", width: "56px", cell: (i) =>
    //   Button({ variant: "ghost", size: "sm", icon: "check", label: `Complete item ${i.id}`, tool: "complete_item", args: { id: i.id } }) },
  ],
});
