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

// DEV=1 (set by dev.mjs): seed notes, and /dev signs the browser in without the Continue page.
if (process.env.DEV) {
  for (const [title, body] of [["Ship the UI layer", "Stateless core, one sync tool"], ["Write-ahead log", "Group commit, fsync batching"], ["Leader election", ""]])
    await agent.callTool({ name: "add_note", arguments: { title, body } });
  await agent.callTool({ name: "pin_note", arguments: { id: 2 } });
}
const devSession = async (res) => {
  await agent.callTool({ name: "open_notes_in_browser", arguments: {} });
  const r = await ui.site.fetch(new Request(lastUrl, { method: "POST" }));
  res.writeHead(303, { Location: r.headers.get("location"), "Set-Cookie": r.headers.get("set-cookie") }); res.end();
};

http.createServer(async (req, res) => {
  if (process.env.DEV && req.url === "/dev") return devSession(res);
  if (process.env.DEV && req.url === "/ui/" && req.method === "GET"
    && (await ui.site.fetch(new Request("http://localhost:3000/ui/", { headers: { cookie: req.headers.cookie ?? "" } }))).status === 401) {
    res.writeHead(303, { Location: "/dev" }); return res.end();
  }
  if (req.url === "/agent" && req.method === "POST") {
    let s = ""; for await (const c of req) s += c;
    const r = await agent.callTool(JSON.parse(s));
    res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ...r, elicitedUrl: lastUrl }));
  }
  ui.site.node(req, res);
}).listen(3000, "127.0.0.1", () => console.log("ready")); // loopback only: /dev and /agent are unauthenticated test routes, never deploy this file
