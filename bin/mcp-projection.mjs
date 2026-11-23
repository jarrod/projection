#!/usr/bin/env node
// mcp-projection preview <module> [params-json] [--dark] [--user=id] > out.html
// The module must export `ui` (the value returned by defineUi). Renders with styles, no runtime.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [cmd, mod, ...rest] = process.argv.slice(2);
if (cmd !== "preview" || !mod) { console.error(`usage: mcp-projection preview <module.js> ['{"param":"value"}'] [--dark] [--user=id]`); process.exit(1); }
const m = await import(pathToFileURL(resolve(mod)).href);
const ui = m.ui ?? m.default;
if (!ui?.preview) { console.error(`${mod} must export "ui" from defineUi()`); process.exit(1); }
const params = rest.find((a) => !a.startsWith("--"));
const user = rest.find((a) => a.startsWith("--user="))?.slice(7);
process.stdout.write(await ui.preview(params && JSON.parse(params), { theme: rest.includes("--dark") ? "dark" : rest.includes("--light") ? "light" : undefined, user }));
process.exit(0);
