import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { store, userOf } from "./store.js";
import { ui } from "./ui.js";

export function createServer() {
  const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));

  server.registerTool("add_note", {
    description: "Create a note",
    inputSchema: z.object({ title: z.string(), body: z.string() }),
  }, async ({ title, body }, ctx) => {
    const n = store.add(userOf(ctx), title, body);
    return { content: [{ type: "text", text: `Created note #${n.id}: ${n.title}` }] };
  });

  server.registerTool("list_notes", {
    description: "List all notes",
    inputSchema: z.object({}),
  }, async (_args, ctx) => ({
    content: [{ type: "text", text: store.list(userOf(ctx)).map((n) => `#${n.id}${n.pinned ? " (pinned)" : ""} ${n.title}`).join("\n") || "No notes" }],
  }));

  server.registerTool("pin_note", {
    description: "Toggle pin on a note",
    inputSchema: z.object({ id: z.coerce.number() }),
  }, async ({ id }, ctx) => {
    const n = store.pin(userOf(ctx), id);
    return { content: [{ type: "text", text: n ? `#${n.id} pinned=${n.pinned}` : "Not found" }] };
  });

  return server;
}

// The MCP endpoint, stateless: a new server for every request. web.mcp (ui.ts) gives it to projector, so a browser's
// calls come in the way an agent's would. To serve agents over HTTP too, route POST /mcp here, behind the same auth, and
// pass the authInfo it found: handler.fetch(request, { authInfo }).
// (server.ts and ui.ts import each other, which is fine: each uses the other only inside a function.)
const handler = createMcpHandler(createServer);
export const handleMcp = (request: Request): Promise<Response> => handler.fetch(request);
