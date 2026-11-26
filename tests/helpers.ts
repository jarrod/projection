// Shared by the test files.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";

/** The message a call throws, or "" when it doesn't throw. */
export const err = async (fn: () => unknown): Promise<string> => {
  try { await fn(); return ""; } catch (e) { return (e as Error).message; }
};

/** A client connected to `server` in memory. */
export const connect = async (server: McpServer, name = "agent", capabilities: Record<string, unknown> = {}): Promise<Client> => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const c = new Client({ name, version: "1" }, { capabilities });
  await c.connect(a);
  return c;
};

/** The first text block of a tool result. */
export const textOf = (r: any): string => r?.content?.[0]?.text ?? "";

// Vitest adds Vite's env (DEV, PROD, MODE, SSR, BASE_URL), NODE_ENV=test and its own VITEST_* variables to process.env.
// A child process gets the environment without them, as it would have outside Vitest.
const ADDED = new Set(["DEV", "PROD", "MODE", "SSR", "BASE_URL", "TEST"]);
export const childEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !ADDED.has(k) && !k.startsWith("VITEST")));
  if (env.NODE_ENV === "test") delete env.NODE_ENV;
  return { ...env, ...extra };
};
