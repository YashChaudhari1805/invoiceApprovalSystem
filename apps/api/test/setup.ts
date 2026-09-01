import * as dotenv from "dotenv";
// Runs before any test file is imported, so process.env is populated before
// modules like src/lib/supabase.ts read it at their own import time.
dotenv.config({ path: "../../.env" });
