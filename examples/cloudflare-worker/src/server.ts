import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { ui } from "./ui.js";

// Notes live in D1, for one user ("local": this example has no sign-in, and projector's default identity is "local" too).
const USER = "local";
const db = () => env.DB;

export function createServer() {
  const server = ui.attach(new McpServer({ name: "notes", version: "1.0.0" }));

  server.registerTool("add_note", {
    description: "Create a note",
    inputSchema: z.object({ title: z.string(), body: z.string() }),
  }, async ({ title, body }) => {
    const id = (await db().prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM notes WHERE user = ?").bind(USER).first<number>("id"))!;
    await db().prepare("INSERT INTO notes (user, id, title, body) VALUES (?, ?, ?, ?)").bind(USER, id, title, body).run();
    return { content: [{ type: "text", text: `Created note #${id}: ${title}` }] };
  });

  server.registerTool("list_notes", {
    description: "List all notes",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    const { results } = await db().prepare("SELECT id, title, pinned FROM notes WHERE user = ? ORDER BY id").bind(USER).all<{ id: number; title: string; pinned: number }>();
    return { content: [{ type: "text", text: results.map((n) => `#${n.id}${n.pinned ? " (pinned)" : ""} ${n.title}`).join("\n") || "No notes" }] };
  });

  server.registerTool("pin_note", {
    description: "Toggle pin on a note",
    inputSchema: z.object({ id: z.coerce.number() }),
  }, async ({ id }) => {
    const n = await db().prepare("UPDATE notes SET pinned = 1 - pinned WHERE user = ? AND id = ? RETURNING id, pinned").bind(USER, id).first<{ id: number; pinned: number }>();
    return { content: [{ type: "text", text: n ? `#${n.id} pinned=${!!n.pinned}` : "Not found" }] };
  });

  server.registerTool("edit_note", {
    description: "Change a note's title, body, or both",
    inputSchema: z.object({ id: z.coerce.number(), title: z.string().optional(), body: z.string().optional() }),
  }, async ({ id, title, body }) => {
    const n = await db().prepare("UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body) WHERE user = ? AND id = ? RETURNING id, title")
      .bind(title ?? null, body ?? null, USER, id).first<{ id: number; title: string }>();
    return n ? { content: [{ type: "text", text: `Updated note #${n.id}: ${n.title}` }] } : { content: [{ type: "text", text: `No note #${id}` }], isError: true };
  });

  return server;
}

// The /mcp endpoint, stateless: a new server for every request. The Worker routes /mcp here, and web.mcp (ui.ts) gives
// it to projector, so a browser's calls come in the same way an agent's do.
// (server.ts and ui.ts import each other, which is fine: each uses the other only inside a function.)
export const handleMcp = (request: Request): Promise<Response> => createMcpHandler(createServer).fetch(request);
