#!/usr/bin/env node
// Snapshot what the MODEL sees from an MCP server: model-visible tools (everything except _meta) and,
// optionally, the results of some tool calls. Take one before adding a UI and compare after.
//
//   node tool-snapshot.mjs --out before.json -- node dist/index.js
//   node tool-snapshot.mjs --compare before.json -- node dist/index.js
//   node tool-snapshot.mjs --url http://localhost:3000/mcp --out before.json
//
// Options
//   --out <file>       write the snapshot to a file (default: print it)
//   --compare <file>   compare with a saved snapshot. Exit 1 if a tool changed or disappeared,
//                      or a recorded call returned something different. New tools are listed, not fatal.
//   --strict           with --compare, new model-visible tools are fatal too
//   --calls <file>     JSON array of [toolName, args] pairs to call and record. Only use tools that
//                      are safe to run against this server's data (reads, or a throwaway database).
//   --cwd <dir>        where to run the command and resolve @modelcontextprotocol/sdk (default: .)
//   --url <url>        connect over Streamable HTTP instead of spawning a stdio command
//
// Needs @modelcontextprotocol/sdk installed in the project (it is, if the project is an MCP server).
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const opts = dash < 0 ? argv : argv.slice(0, dash);
const command = dash < 0 ? [] : argv.slice(dash + 1);
const flag = (n) => opts.includes(n);
const val = (n) => { const i = opts.indexOf(n); return i < 0 ? undefined : opts[i + 1]; };
const die = (m) => { console.error(`tool-snapshot: ${m}`); process.exit(2); };

const cwd = resolve(val("--cwd") ?? ".");
const url = val("--url");
if (!url && !command.length) die("give a server command after --, or --url <endpoint>. See the header of this file.");

// Resolve the SDK from the project, not from this script's folder. Prefer the ESM build.
const req = createRequire(join(cwd, "package.json"));
async function sdk(sub) {
  let p;
  try { p = req.resolve(`@modelcontextprotocol/sdk/${sub}`); }
  catch { die(`can't find @modelcontextprotocol/sdk from ${cwd}. Run this from the MCP server's project folder (or pass --cwd).`); }
  const esm = p.replace(/([\\/])dist[\\/]cjs[\\/]/, "$1dist$1esm$1");
  return import(pathToFileURL(existsSync(esm) ? esm : p).href);
}

const { Client } = await sdk("client/index.js");
let transport;
if (url) {
  const { StreamableHTTPClientTransport } = await sdk("client/streamableHttp.js");
  transport = new StreamableHTTPClientTransport(new URL(url));
} else {
  const { StdioClientTransport } = await sdk("client/stdio.js");
  transport = new StdioClientTransport({ command: command[0], args: command.slice(1), cwd, env: { ...process.env }, stderr: "inherit" });
}

const client = new Client({ name: "tool-snapshot", version: "1.0.0" });
await client.connect(transport);

const all = [];
for (let cursor; ;) {
  const page = await client.listTools(cursor ? { cursor } : {});
  all.push(...page.tools);
  if (!(cursor = page.nextCursor)) break;
}
const appOnly = (t) => (t._meta?.ui?.visibility ?? ["model"]).every((v) => v === "app");
const visible = all.filter((t) => !appOnly(t));
const snapshot = {
  tools: visible.map(({ _meta, ...rest }) => rest).sort((a, b) => a.name.localeCompare(b.name)),
  // Informational, not compared: hosts read these, the model does not.
  appOnlyTools: all.filter(appOnly).map((t) => t.name).sort(),
  uiResources: Object.fromEntries(all.filter((t) => t._meta?.ui?.resourceUri).map((t) => [t.name, t._meta.ui.resourceUri])),
  calls: [],
};

const callsFile = val("--calls");
if (callsFile) {
  for (const [name, args = {}] of JSON.parse(readFileSync(resolve(callsFile), "utf8"))) {
    const r = await client.callTool({ name, arguments: args });
    snapshot.calls.push({ name, args, content: r.content, structuredContent: r.structuredContent ?? null, isError: r.isError ?? false });
  }
}
await client.close();

const out = val("--out");
const cmp = val("--compare");
if (out) writeFileSync(resolve(out), JSON.stringify(snapshot, null, 2) + "\n");
if (!cmp) {
  if (!out) console.log(JSON.stringify(snapshot, null, 2));
  else console.error(`tool-snapshot: wrote ${snapshot.tools.length} model-visible tools${snapshot.calls.length ? ` and ${snapshot.calls.length} calls` : ""} to ${out}`);
  process.exit(0);
}

// ---- compare ----
const base = JSON.parse(readFileSync(resolve(cmp), "utf8"));
const byName = (ts) => new Map(ts.map((t) => [t.name, t]));
const before = byName(base.tools ?? []), after = byName(snapshot.tools);
const problems = [], notes = [];
for (const [name, t] of before) {
  const now = after.get(name);
  if (!now) { problems.push(`tool "${name}" is gone or now app-only`); continue; }
  for (const k of new Set([...Object.keys(t), ...Object.keys(now)])) {
    if (!isDeepStrictEqual(t[k], now[k])) problems.push(`tool "${name}": "${k}" changed\n    before: ${JSON.stringify(t[k])}\n    after:  ${JSON.stringify(now[k])}`);
  }
}
const added = [...after.keys()].filter((n) => !before.has(n));
if (added.length) (flag("--strict") ? problems : notes).push(`new model-visible tools: ${added.join(", ")} (expected only for defineUi({ web: { tool } }))`);
(base.calls ?? []).forEach((c, i) => {
  const now = snapshot.calls[i];
  if (!now) return problems.push(`call ${i} (${c.name}) was not made this time. Pass the same --calls file.`);
  const pick = (x) => ({ content: x.content, structuredContent: x.structuredContent, isError: x.isError });
  if (!isDeepStrictEqual(pick(c), pick(now))) problems.push(`call ${i} (${c.name}) returned something different\n    before: ${JSON.stringify(pick(c))}\n    after:  ${JSON.stringify(pick(now))}`);
});
if (snapshot.appOnlyTools.length) notes.push(`app-only tools (hidden from the model): ${snapshot.appOnlyTools.join(", ")}`);
if (Object.keys(snapshot.uiResources).length) notes.push(`tools that open a UI: ${Object.entries(snapshot.uiResources).map(([n, u]) => `${n} → ${u}`).join(", ")}`);

for (const n of notes) console.log(`note: ${n}`);
if (problems.length) {
  console.log(`\nFAIL: the model-facing surface changed (${problems.length})`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`\nOK: ${before.size} tools${base.calls?.length ? ` and ${base.calls.length} call results` : ""} unchanged for the model`);
