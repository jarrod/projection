import { defineConfig } from "vitest/config";

// unit: what `pnpm test` runs. web: real Chrome on port 3000. workers: wrangler dev.
// Tests in a file run in order and share state, as the old scripts did; files run in parallel.
export default defineConfig({
  test: {
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/t*.test.mjs"], exclude: ["tests/t3-web.test.mjs", "tests/t6-workers.test.mjs"] } },
      { extends: true, test: { name: "web", include: ["tests/t3-web.test.mjs"] } },
      { extends: true, test: { name: "workers", include: ["tests/t6-workers.test.mjs"] } },
    ],
  },
});
