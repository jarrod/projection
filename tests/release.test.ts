import { describe, test, expect } from "vitest";

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
// What apps get when they install a release tag: the packed file list, and the docs in it.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packed: string[] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" }))[0].files.map((f) => f.path);
const docs = packed.filter((f) => f.endsWith(".md"));
const read = (f: string) => readFileSync(join(root, f), "utf8");

describe("release package", () => {
  test("ships the built library, the bin, the docs, the skill and the license", () => {
    for (const f of ["dist/index.js", "dist/index.d.ts", "dist/testing.js", "dist/assets.js", "bin/mcp-projector.mjs", "AGENTS.md", "README.md", "docs/getting-started.md", "skills/mcp-projector/SKILL.md", "LICENSE"]) expect(packed).toContain(f);
  });
  // A fixed tag in the docs goes stale at the next release, so install commands ask for the latest.
  test("every install command installs the latest release", () => {
    const refs = docs.flatMap((f) => [...read(f).matchAll(/github:jarrod\/projector(#[^\s`'"]*)?/g)].map((m) => `${f}: ${m[1] ?? "(no ref)"}`));
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((r) => !r.endsWith(": #latest"))).toEqual([]);
  });
  test("the changelog has an entry for this version", () => {
    expect(read("CHANGELOG.md")).toMatch(new RegExp(`^## ${pkg.version.replaceAll(".", "\\.")} `, "m"));
  });
  // Docs are read from node_modules, so a relative link must point at a file in the package.
  test("relative links in shipped docs resolve inside the package", () => {
    const broken = docs.flatMap((f) => [...read(f).matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)|\b(?:src|srcset)="([^"#\s]+)"/g)]
      .map((m) => m[1] ?? m[2]).filter((l) => !/^[a-z]+:/.test(l))
      .map((l) => normalize(join(dirname(f), l))).filter((p) => !packed.includes(p) && !packed.some((x) => x.startsWith(p + "/")))
      .map((p) => `${f} -> ${p}`));
    expect(broken).toEqual([]);
  });
});
