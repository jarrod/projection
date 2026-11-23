import { build } from "esbuild";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

rmSync("dist", { recursive: true, force: true });
const bundle = async (mode) => (await build({ entryPoints: [`src/client/entry-${mode}.ts`], bundle: true, minify: true, format: "iife", write: false, target: "es2022" })).outputFiles[0].text.trim();
const RUNTIME = await bundle("mcp"), WEB = await bundle("web");
const CSS = (await build({ entryPoints: ["src/ui/style.css"], bundle: true, minify: true, write: false, loader: { ".css": "css" } })).outputFiles[0].text.trim();
for (const [n, s] of [["runtime", RUNTIME], ["web", WEB]]) if (/<\/script/i.test(s)) throw new Error(n + " contains </script");

execSync("npx tsc -p tsconfig.json", { stdio: "inherit" });
execSync("npx tsc -p tsconfig.client.json", { stdio: "inherit" });
mkdirSync("dist", { recursive: true });
writeFileSync("dist/assets.js", `export const RUNTIME = ${JSON.stringify(RUNTIME)};\nexport const WEB = ${JSON.stringify(WEB)};\nexport const CSS = ${JSON.stringify(CSS)};\n`);
writeFileSync("dist/assets.d.ts", readFileSync("src/assets.d.ts"));

const server = (await build({ entryPoints: ["dist/index.js"], bundle: true, minify: true, format: "esm", platform: "node", write: false, external: ["zod", "@modelcontextprotocol/sdk", "node:*", "./assets.js"],
  plugins: [{ name: "x", setup(b) { b.onResolve({ filter: /assets\.js$/ }, (a) => ({ path: a.path, external: true })); } }] })).outputFiles[0].text;

const gz = (s) => gzipSync(s, { level: 9 }).length;
const budget = {
  "browser runtime, MCP host": [RUNTIME, 2500], "browser runtime, web": [WEB, 2000],
  "kit CSS": [CSS, 4000], "server library (never sent to browser)": [server, 7000] };
let over = false;
console.log("\nsize (min+gzip)                     bytes   budget");
for (const [k, [s, b]] of Object.entries(budget)) { const n = gz(s); over ||= n > b; console.log(`${k.padEnd(34)} ${String(n).padStart(6)}   ${b}${n > b ? "  OVER" : ""}`); }
if (over) { console.error("size budget exceeded"); process.exit(1); }
