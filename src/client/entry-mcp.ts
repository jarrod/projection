import { start } from "./runtime.js";
import { mcpBridge } from "./bridge.js";
mcpBridge().then((t) => start(t)).catch((e) => console.error("[mcp-projection]", e));
