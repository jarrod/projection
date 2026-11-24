import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { store } from "./store.js";
import { ui } from "./ui.js";

export function createServer() {
  const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));

  server.registerTool("add_note", {
    description: "Create a note",
    inputSchema: { title: z.string(), body: z.string() },
  }, async ({ title, body }, extra) => {
    const n = store.add(ui.identify(extra), title, body);
    return { content: [{ type: "text", text: `Created note #${n.id}: ${n.title}` }] };
  });

  server.registerTool("list_notes", {
    description: "List all notes",
    inputSchema: {},
  }, async (_args, extra) => ({
    content: [{ type: "text", text: store.list(ui.identify(extra)).map((n) => `#${n.id}${n.pinned ? " (pinned)" : ""} ${n.title}`).join("\n") || "No notes" }],
  }));

  server.registerTool("pin_note", {
    description: "Toggle pin on a note",
    inputSchema: { id: z.coerce.number() },
  }, async ({ id }, extra) => {
    const n = store.pin(ui.identify(extra), id);
    return { content: [{ type: "text", text: n ? `#${n.id} pinned=${n.pinned}` : "Not found" }] };
  });

  return server;
}
