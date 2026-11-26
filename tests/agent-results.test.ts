// Invariant: attaching a UI never changes what the model sees. The same tools are registered on two servers, one
// with ui.attach and one without, and an agent on each must get the same tools and the same results, errors included.
// The only differences allowed are the ones projector adds on purpose: the open_<name>_in_browser tool, tools only
// the app can see (p_sync), and _meta.ui.
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { defineUi, html } from "mcp-projector";
import { connect } from "./helpers.ts";

const APPS = { extensions: { "io.modelcontextprotocol/ui": {} } };

// Tools of every shape the model can be given: plain, annotated, with an output schema and structured content,
// with _meta of their own, one that reports an error, and one that throws.
const register = (s: McpServer) => {
  const notes: { id: number; title: string; pinned: boolean }[] = [];
  s.registerTool("add_note", { description: "Create a note", inputSchema: z.object({ title: z.string(), body: z.string() }) },
    async ({ title }) => { notes.push({ id: notes.length + 1, title, pinned: false }); return { content: [{ type: "text", text: `Created note #${notes.length}: ${title}` }] }; });
  s.registerTool("list_notes", { title: "Notes", description: "List all notes", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => ({ content: [{ type: "text", text: notes.map((n) => `#${n.id}${n.pinned ? " (pinned)" : ""} ${n.title}`).join("\n") || "No notes" }] }));
  s.registerTool("pin_note", { description: "Toggle pin on a note", inputSchema: z.object({ id: z.coerce.number() }), _meta: { "example.com/owner": "notes" } },
    async ({ id }) => {
      const n = notes.find((x) => x.id === id);
      if (!n) return { content: [{ type: "text", text: "Not found" }], isError: true };
      n.pinned = !n.pinned;
      return { content: [{ type: "text", text: `#${n.id} pinned=${n.pinned}` }], _meta: { "example.com/changed": n.id } };
    });
  s.registerTool("count_notes", { description: "Count notes", outputSchema: z.object({ total: z.number(), pinned: z.number() }), annotations: { readOnlyHint: true } },
    async () => {
      const out = { total: notes.length, pinned: notes.filter((n) => n.pinned).length };
      return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
    });
  s.registerTool("explode", { description: "Always fails" }, async () => { throw new Error("boom"); });
};

const CALLS: [string, Record<string, unknown>][] = [
  ["add_note", { title: "Hello", body: "x" }], ["pin_note", { id: 1 }], ["list_notes", {}], ["count_notes", {}],
  ["pin_note", { id: 999 }], // unknown note: an error result
  ["add_note", { title: 5 }], // bad argument
  ["explode", {}], // the handler throws
  ["no_such_tool", {}],
];

// Everything the model is given, minus what projector adds on purpose.
const seenBy = async (server: McpServer, capabilities = {}) => {
  const c = await connect(server, "agent", capabilities);
  const strip = (m?: Record<string, unknown>) => { const { ui, ...rest } = m ?? {}; return Object.keys(rest).length ? rest : undefined; };
  const tools = (await c.listTools()).tools
    .filter((t) => !/^open_.*_in_browser$/.test(t.name) && !((t._meta?.ui as any)?.visibility ?? ["model"]).every((v: string) => v === "app"))
    .map((t) => ({ ...t, _meta: strip(t._meta) }));
  const calls: unknown[] = [];
  for (const [name, args] of CALLS) {
    const r: any = await c.callTool({ name, arguments: args }).catch((e) => ({ thrown: e.message }));
    calls.push({ ...r, _meta: strip(r._meta) });
  }
  return { tools, calls };
};

const plain = () => { const s = new McpServer({ name: "notes", version: "1.0.0" }); register(s); return s; };
const withUi = () => {
  const ui = defineUi({ name: "notes", attachTo: ["list_notes"], view: async ({ call }) => html`<pre>${(await call("list_notes")).content[0].text}</pre>` });
  const s = ui.attach(new McpServer({ name: "notes", version: "1.0.0" })); register(s); return s;
};

describe("ui.attach leaves the model's view unchanged", () => {
  for (const [label, caps] of [["a plain client", {}], ["a client that announces MCP Apps", APPS]] as const) {
    test(label, async () => {
      const without = await seenBy(plain(), caps), with_ = await seenBy(withUi(), caps);
      expect(without.tools.map((t) => t.name)).toEqual(["add_note", "list_notes", "pin_note", "count_notes", "explode"]);
      expect(with_).toEqual(without);
    });
  }
  test("the projector additions are there, so the filter above is not hiding everything", async () => {
    const c = await connect(withUi(), "host", APPS);
    const tools = (await c.listTools()).tools;
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["open_notes_in_browser", "p_sync"]));
    expect((tools.find((t) => t.name === "list_notes")?._meta?.ui as any)?.resourceUri).toMatch(/^ui:\/\//);
  });
});
