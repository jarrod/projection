// src/ui.ts: the whole human UI for this MCP server. Keep all UI code in this file.
// Replace every TODO, then delete the comments you don't need.
import { defineUi, html, Header, Badge, Dot, Stat, Grid, Table, Card, Empty, Muted, Stack } from "mcp-projection"; // add Button, Dialog, Form, Input... as needed
import { store, type Item } from "./store.js"; // TODO: the module your tools already use for data

// One identity function, shared with any app-only ui_* tools in server.ts.
export const userOf = (extra: any): string => extra?.authInfo?.extra?.sub ?? extra?.authInfo?.clientId ?? "local";

export const ui = defineUi({
  name: "items", // TODO: short name; the resource becomes ui://items/app.html
  identify: userOf,

  // Data keys → loaders. Call the store directly (not the tools). Must be fast and must not throw.
  load: {
    items: () => store.list(), // TODO
  },

  // EVERY tool that changes data the UI shows → keys it changes. Also the allow-list for UI actions.
  writes: {
    // add_item: ["items"],
    // update_item: ["items"],
  },

  // Tools after which a person wants to look (usually the main read tool).
  attachTo: [/* "list_items" */],

  // Optional: serve on a URL too. `tool` adds ONE model-visible tool; leave it out unless wanted.
  // web: { origin: process.env.UI_ORIGIN ?? "http://localhost:3000", tool: "open_items_in_browser" },
});

// Root: reads nothing, so it never re-renders. Layout, dialogs and child fragments live here.
ui.fragment("app", async ({ frag }) => html`
  <div class="stack" style="--gap:20px;max-width:960px;margin:0 auto">
    ${Header({
      title: "Items", // TODO
      description: html`<span class="row" style="--gap:6px">${Dot({ tone: "ok", pulse: true, label: "Live" })} Shared with your assistant</span>`,
    })}
    ${await frag("stats")}
    ${Card({ title: "All items", flush: true }, await frag("list"))}
  </div>`);

// Leaves: each reads only what it shows.
ui.fragment("stats", async ({ read }) => {
  const items = await read("items");
  return Grid({ min: 140 }, Stat({ label: "Items", value: items.length }));
});

ui.fragment("list", async ({ read }) => {
  const items = await read("items");
  return Table<Item>({
    id: "items", rows: items, rowKey: (i) => i.id, // stable, page-unique row ids
    empty: html`<div style="padding:16px">${Empty({ title: "No items yet", description: "Ask your assistant to add one." })}</div>`,
    columns: [
      { label: "#", cell: (i) => i.id, mono: true, width: "48px" },
      { label: "Item", cell: (i) => Stack({ gap: 2 }, html`<strong style="font-weight:500">${i.title}</strong>`, Muted(i.owner)) },
      { label: "Status", width: "120px", cell: (i) => Badge({ tone: i.done ? "ok" : "neutral", dot: true }, i.done ? "Done" : "Open") },
      // Row action (import Button): typed values go in args, since UI calls skip zod coercion and defaults. The tool must be in writes.
      // { label: "", align: "right", width: "56px", cell: (i) =>
      //   Button({ variant: "ghost", size: "sm", icon: "check", label: `Complete item ${i.id}`, tool: "complete_item", args: { id: i.id } }) },
    ],
  });
});
