import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { createServer as http } from "node:http";
import { ui } from "./ui.js";

await createServer().connect(new StdioServerTransport());

if (process.env.UI_PORT) http((req, res) => ui.site!.node(req, res)).listen(+process.env.UI_PORT);
