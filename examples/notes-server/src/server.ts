import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { store, userOf } from "./store.js";
import { ui } from "./ui.js";

export function createServer() {
  const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));

  server.registerTool("add_note", {
    description: "Create a note",
    inputSchema: { title: z.string(), body: z.string() },
  }, async ({ title, body }, extra) => {
    const n = store.add(userOf(extra), title, body);
    return { content: [{ type: "text", text: `Created note #${n.id}: ${n.title}` }] };
  });

  server.registerTool("list_notes", {
    description: "List all notes",
    inputSchema: {},
  }, async (_args, extra) => ({
    content: [{ type: "text", text: store.list(userOf(extra)).map((n) => `#${n.id}${n.pinned ? " (pinned)" : ""} ${n.title}`).join("\n") || "No notes" }],
  }));

  server.registerTool("pin_note", {
    description: "Toggle pin on a note",
    inputSchema: { id: z.coerce.number() },
  }, async ({ id }, extra) => {
    const n = store.pin(userOf(extra), id);
    return { content: [{ type: "text", text: n ? `#${n.id} pinned=${n.pinned}` : "Not found" }] };
  });

  return server;
}

// The MCP endpoint, stateless Streamable HTTP: a new server and transport for every request. web.mcp (ui.ts) gives it to
// projector, so a browser's calls come in the way an agent's would. To serve agents over HTTP too, route POST /mcp here,
// behind the same auth. (server.ts and ui.ts import each other, which is fine: each uses the other only inside a function.)
export async function handleMcp(request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await createServer().connect(transport);
  return transport.handleRequest(request);
}
