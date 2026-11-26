// Vitest adds Vite's env (DEV, PROD, MODE, SSR, BASE_URL), NODE_ENV=test and its own VITEST_* variables to process.env.
// A child process gets the environment without them, as it had when these tests ran under plain node.
const ADDED = new Set(["DEV", "PROD", "MODE", "SSR", "BASE_URL", "TEST"]);
export const childEnv = (extra = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !ADDED.has(k) && !k.startsWith("VITEST")));
  if (env.NODE_ENV === "test") delete env.NODE_ENV;
  return { ...env, ...extra };
};
