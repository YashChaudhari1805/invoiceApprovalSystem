import * as dotenv from "dotenv";
import path from "node:path";

/** Loads the repo-root .env (works from both src/ and the compiled dist/). */
export function loadEnvFile(): void {
  dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });
}

// Read lazily, inside a request, never at import time: ES imports are hoisted
// above any dotenv.config() call, so a module-level read would see nothing.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getPort(): number {
  return Number(process.env.PORT) || 4000;
}

/**
 * Fail closed. With FRONTEND_URL unset, `origin: true` would reflect ANY origin
 * alongside `credentials: true`. So: the configured frontend; else the local dev
 * server outside production; else no CORS headers at all. (The Next.js app calls
 * this API from its server, so browsers never need cross-origin access.)
 */
export function getAllowedOrigin(): string | false {
  return process.env.FRONTEND_URL ?? (process.env.NODE_ENV === "production" ? false : "http://localhost:3000");
}
