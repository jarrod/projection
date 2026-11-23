// Acts as an AI agent: list tools, call them, print everything the model would see.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const { createServer } = await import(process.argv[2]);
const [ct, st] = InMemoryTransport.createLinkedPair();
await createServer().connect(st);
const c = new Client({ name: "agent", version: "1" });
await c.connect(ct);
// argv[3..]: tools the UI adds for the model on purpose (the opt-in "open in browser" tool); everything else must match the baseline.
const optIn = process.argv.slice(3);
const tools = (await c.listTools()).tools.filter((t) => !optIn.includes(t.name) && !(t._meta?.ui?.visibility ?? ["model"]).every((v) => v === "app"));
const out = { modelVisibleTools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), calls: [] };
for (const [name, args] of [["add_note", { title: "Hello", body: "x" }], ["pin_note", { id: 1 }], ["list_notes", {}]]) {
  const r = await c.callTool({ name, arguments: args });
  out.calls.push({ name, content: r.content, structuredContent: r.structuredContent ?? null });
}
console.log(JSON.stringify(out, null, 1));
process.exit(0);
