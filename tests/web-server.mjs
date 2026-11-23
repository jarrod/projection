// Runs the notes MCP server + its web UI, and an "agent" MCP client that supports URL elicitation.
import http from "node:http";
const NS = new URL("../examples/notes-server", import.meta.url).pathname;
const { Client } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
const { InMemoryTransport } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`);
const { ElicitRequestSchema } = await import(`${NS}/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js`);
const { createServer } = await import(`${NS}/dist/server.js`);
const { ui } = await import(`${NS}/dist/ui.js`);

const [a, b] = InMemoryTransport.createLinkedPair();
await createServer().connect(b);
const agent = new Client({ name: "agent", version: "1" }, { capabilities: { elicitation: { form: {}, url: {} } } });
let lastUrl = null;
agent.setRequestHandler(ElicitRequestSchema, async (req) => { lastUrl = req.params.url; return { action: "accept" }; });
await agent.connect(a);

http.createServer(async (req, res) => {
  if (req.url === "/agent" && req.method === "POST") {
    let s = ""; for await (const c of req) s += c;
    const r = await agent.callTool(JSON.parse(s));
    res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ...r, elicitedUrl: lastUrl }));
  }
  ui.site.node(req, res);
}).listen(3000, () => console.log("ready"));
