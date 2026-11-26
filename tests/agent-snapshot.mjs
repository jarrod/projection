// Acts as an AI agent: list tools, call them, print everything the model would see.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const { createServer } = await import(pathToFileURL(resolve(process.argv[2])).href);
const [ct, st] = InMemoryTransport.createLinkedPair();
await createServer().connect(st);
const c = new Client({ name: "agent", version: "1" });
await c.connect(ct);
// argv[3..]: tools the UI adds for the model on purpose (the opt-in "open in browser" tool); everything else must match the baseline.
const optIn = process.argv.slice(3);
const tools = (await c.listTools()).tools.filter((t) => !optIn.includes(t.name) && !(t._meta?.ui?.visibility ?? ["model"]).every((v) => v === "app"));
// Everything the model is given about a tool, except the one thing the UI adds on purpose (_meta.ui).
const meta = (m) => { const { ui, ...rest } = m ?? {}; return Object.keys(rest).length ? rest : undefined; };
const out = { modelVisibleTools: tools.map(({ name, title, description, inputSchema, outputSchema, annotations, _meta }) => ({ name, title, description, inputSchema, outputSchema, annotations, _meta: meta(_meta) })), calls: [] };
// The last two fail on purpose (unknown note, bad argument): error results must not change either.
for (const [name, args] of [["add_note", { title: "Hello", body: "x" }], ["pin_note", { id: 1 }], ["list_notes", {}], ["pin_note", { id: 999 }], ["add_note", { title: 5 }]]) {
  const r = await c.callTool({ name, arguments: args }).catch((e) => ({ thrown: e.message }));
  out.calls.push({ name, content: r.content, structuredContent: r.structuredContent ?? null, isError: r.isError ?? false, _meta: meta(r._meta), thrown: r.thrown });
}
console.log(JSON.stringify(out, null, 1));
process.exit(0);
