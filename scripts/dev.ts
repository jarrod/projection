// Dev loop: edit the library or the example, see it in the browser. Open http://localhost:3000/dev once.
// On a change it rebuilds (about 1 s), restarts web-server.ts with seed data, and the open page reloads itself:
// its poll fails while the server is down, then gets 401, reloads, and /ui/ sends it to /dev for a fresh session.
import { spawn, execSync } from "node:child_process";
import { watch } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const run = (cmd) => { try { execSync(cmd, { cwd: root, stdio: "inherit" }); return true; } catch { return false; } };
let child, timer, pending = new Set();

const start = () => {
  child = spawn("node", ["scripts/web-server.ts"], { cwd: root, stdio: "inherit", env: { ...process.env, DEV: "1" } });
};
const rebuild = () => {
  const lib = pending.has("lib"), ex = pending.has("example");
  pending.clear();
  console.log(`\n[dev] change in ${[lib && "library", ex && "example"].filter(Boolean).join(" + ")}, rebuilding`);
  if (lib && !run("node scripts/build.ts")) return;
  if (ex && !run("node_modules/.bin/tsc -p examples/notes-server")) return;
  child.once("exit", start);
  child.kill();
};
const on = (dir, kind) => watch(root + dir, { recursive: true }, () => {
  pending.add(kind);
  clearTimeout(timer);
  timer = setTimeout(rebuild, 100);
});

on("src", "lib");
on("examples/notes-server/src", "example");
start();
