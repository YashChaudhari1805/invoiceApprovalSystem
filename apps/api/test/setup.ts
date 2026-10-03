import * as dotenv from "dotenv";
import path from "node:path";
import { expect } from "vitest";

// Resolved relative to THIS file, not the current working directory — the old
// relative "../../.env" only worked when vitest happened to be launched from
// apps/api. `.env.test` (if present) wins over `.env`, so a developer can keep
// a dedicated test project's keys separate from their everyday ones.
const repoRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(repoRoot, ".env.test") });
dotenv.config({ path: path.join(repoRoot, ".env") }); // dotenv never overrides values already set

// ---------------------------------------------------------------------------
// Safety rail. The integration tests create and delete real rows (through a
// service-role key that bypasses RLS) and sign in with fixed demo passwords.
// Pointing them at a project that holds real data would be a bad day, so:
//   * a local Supabase (localhost / 127.0.0.1) is always fine;
//   * any hosted project must be opted into explicitly.
// ---------------------------------------------------------------------------
const testPath = expect.getState().testPath ?? "";
const isIntegration = testPath.includes(`${path.sep}integration${path.sep}`);

// Unit tests need no database and must keep running without any env at all.
const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
if (isIntegration && missing.length > 0) {
  throw new Error(
    `Integration tests need these environment variables: ${missing.join(", ")}.\n` +
      `Copy .env.example to .env.test and fill it in (see "Running the tests" in the README).`
  );
}

const host = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname : "";
const isLocal = host === "localhost" || host === "127.0.0.1";
if (isIntegration && process.env.SUPABASE_URL && !isLocal && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
  throw new Error(
    `Refusing to run integration tests against the hosted Supabase project "${host}".\n` +
      `These tests write and delete data using the service-role key. Use a dedicated TEST project\n` +
      `or a local Supabase, then set ALLOW_REMOTE_TEST_DB=1 to confirm that is what this is.`
  );
}
