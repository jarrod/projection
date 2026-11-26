import { build } from "esbuild";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

rmSync("dist", { recursive: true, force: true });
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const bundle = async (mode) => (await build({ entryPoints: [`src/client/entry-${mode}.ts`], define: { __VERSION__: JSON.stringify(version) }, bundle: true, minify: true, format: "iife", write: false, target: "es2022" })).outputFiles[0].text.trim();
const RUNTIME = await bundle("mcp"), WEB = await bundle("web");
const css = async (f) => (await build({ entryPoints: [f], bundle: true, minify: true, write: false, loader: { ".css": "css" } })).outputFiles[0].text.trim();
const TOKENS = await css("src/ui/tokens.css"), KIT = await css("src/ui/kit.css"), CSS = TOKENS + KIT;
const THEMES = Object.fromEntries(await Promise.all(readdirSync("src/ui/themes").filter((f) => f.endsWith(".css")).map(async (f) => [f.slice(0, -4), await css(`src/ui/themes/${f}`)])));
for (const [n, s] of [["runtime", RUNTIME], ["web", WEB]]) if (/<\/script/i.test(s)) throw new Error(n + " contains </script");

execSync("npx tsc -p tsconfig.json", { stdio: "inherit" });
execSync("npx tsc -p tsconfig.client.json", { stdio: "inherit" });
mkdirSync("dist", { recursive: true });
writeFileSync("dist/assets.js", `export const RUNTIME = ${JSON.stringify(RUNTIME)};\nexport const WEB = ${JSON.stringify(WEB)};\nexport const CSS = ${JSON.stringify(CSS)};\nexport const TOKENS = ${JSON.stringify(TOKENS)};\nexport const KIT = ${JSON.stringify(KIT)};\nexport const THEMES = ${JSON.stringify(THEMES)};\n`);
writeFileSync("dist/assets.d.ts", readFileSync("src/assets.d.ts"));

const server = (await build({ entryPoints: ["dist/index.js"], bundle: true, minify: true, format: "esm", platform: "node", write: false, external: ["zod", "@modelcontextprotocol/*", "node:*", "./assets.js"],
  plugins: [{ name: "x", setup(b) { b.onResolve({ filter: /assets\.js$/ }, (a) => ({ path: a.path, external: true })); } }] })).outputFiles[0].text;

const gz = (s) => gzipSync(s, { level: 9 }).length;
const budget = {
  "browser runtime, MCP host": [RUNTIME, 2500], "browser runtime, web": [WEB, 2000],
  "kit CSS (tokens + kit)": [CSS, 4000],
  // The server budget is a guard on complexity, not on delivery: this code never reaches a browser.
  // Raised 7000 -> 7500 for the identity, link-redemption and adapter checks from the security review,
  // then -> 8000 for shared renders, the per-session poll limit and input validation from the engineering review,
  // then -> 8100 for the web-by-default review: link fallback, remote-without-origin check, p_sync hidden from plain clients.
  // then -> 10000 by the owner, as an outside limit: SDK v2 support, Workers and stateless hosts. Not a target.
  "server library (never sent to browser)": [server, 10000] };
let over = false;
console.log("\nsize (min+gzip)                     bytes   budget");
for (const [k, [s, b]] of Object.entries(budget)) { const n = gz(s); over ||= n > b; console.log(`${k.padEnd(34)} ${String(n).padStart(6)}   ${b}${n > b ? "  OVER" : ""}`); }
if (over) { console.error("size budget exceeded"); process.exit(1); }
