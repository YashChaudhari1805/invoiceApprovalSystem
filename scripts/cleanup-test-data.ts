// Run with: npx tsx scripts/cleanup-test-data.ts
// Deletes invoices (and their line items via cascade, and activity log
// entries) whose invoice_number matches the prefixes our test suites use.
// Safe to run any time — only touches rows matching these specific
// patterns, never real invoices.

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const TEST_PREFIXES = [
  "ROUTE-TEST-",
  "DETAIL-TEST-",
  "EDIT-TEST-",
  "MK-TEST-",
  "DUP-TEST-",
  "RLS-TEST-",
  "VIEWER-TEST-",
];

async function main() {
  const { data: matches, error: selectError } = await admin
    .from("invoices")
    .select("id, invoice_number")
    .or(TEST_PREFIXES.map((p) => `invoice_number.ilike.${p}%`).join(","));

  if (selectError) throw selectError;
  if (!matches || matches.length === 0) {
    console.log("No test invoices found — nothing to clean up.");
    return;
  }

  const ids = matches.map((m) => m.id);
  console.log(`Found ${ids.length} test invoice(s) to remove.`);

  // Explicitly clear activity_log first — the FK is ON DELETE SET NULL, not
  // CASCADE, so without this the log rows would survive as orphaned entries
  // with a null invoice_id rather than being removed.
  const { error: logError } = await admin.from("activity_log").delete().in("invoice_id", ids);
  if (logError) throw logError;

  // line_items cascade automatically via ON DELETE CASCADE.
  const { error: deleteError } = await admin.from("invoices").delete().in("id", ids);
  if (deleteError) throw deleteError;

  console.log(`Removed ${ids.length} test invoice(s) and their activity log entries.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
