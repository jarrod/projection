import { start } from "./runtime.js";
import { mcpBridge } from "./bridge.js";
const st = JSON.parse(document.getElementById("p-state")?.textContent ?? "{}");
mcpBridge().then((t) => start(t, st)).catch(console.error);
