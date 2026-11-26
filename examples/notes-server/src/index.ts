import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import { createServer as http } from "node:http";
import { ui } from "./ui.js";

await createServer().connect(new StdioServerTransport());

// Hosted: UI_ORIGIN is the public origin, and this process serves the UI on UI_PORT behind it.
if (process.env.UI_ORIGIN) http((req, res) => ui.site!.node(req, res)).listen(+(process.env.UI_PORT ?? 3000));
