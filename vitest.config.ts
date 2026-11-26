import { defineConfig } from "vitest/config";

// unit: what `pnpm test` runs. web: real Chrome on port 3000. workers: wrangler dev. Neither of the last two runs in CI.
// Tests in a file run in order and share state; files run in parallel.
export default defineConfig({
  test: {
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/*.test.ts"] } },
      { extends: true, test: { name: "web", include: ["tests/e2e/browser.test.ts"] } },
      { extends: true, test: { name: "workers", include: ["tests/e2e/workers.test.ts"] } },
    ],
  },
});
