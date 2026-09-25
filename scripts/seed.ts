// Run with: npx tsx scripts/seed.ts
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
// (service role key only — never expose this key to the frontend)
//
// Idempotent: safe to run against a project that's already (partially)
// seeded. Users, organizations, and memberships are looked up / upserted
// instead of blindly inserted, and the sample invoices are only created
// once per organization (skipped entirely if that org already has any).

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

// service role client bypasses RLS entirely — that's expected and required
// for a seed script, since nothing is authenticated as a real user yet
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createUser(email: string, name: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "password123",
    email_confirm: true, // skip the confirmation email for seed users
    user_metadata: { name },
  });

  if (!error) {
    console.log(`  created ${email}`);
    return data.user.id; // profiles row is auto-created by the on_auth_user_created trigger
  }

  // Already exists from a previous run — look up their profile (created by
  // the same trigger the first time round) and reuse that id instead of
  // failing the whole seed.
  if (error.code === "email_exists") {
    const { data: existing, error: lookupError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .single();
    if (lookupError || !existing) {
      throw new Error(
        `${email} already exists in auth.users but no matching profiles row was found. ` +
          `Was the on_auth_user_created trigger removed or did signup partially fail?`
      );
    }
    console.log(`  ${email} already exists — reusing existing user`);
    return existing.id;
  }

  throw error;
}

// Insert-or-fetch, keyed on the given unique column. Avoids relying on
// .upsert() here so a re-run never silently overwrites name/slug edits
// someone made by hand in the dashboard after the first seed.
async function getOrCreateOrg(name: string, slug: string) {
  const { data: existing, error: fetchError } = await admin
    .from("organizations")
    .select()
    .eq("slug", slug)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (existing) {
    console.log(`  ${slug} already exists — reusing existing org`);
    return existing;
  }

  const { data: created, error: insertError } = await admin
    .from("organizations")
    .insert({ name, slug })
    .select()
    .single();
  if (insertError) throw insertError;
  console.log(`  created ${slug}`);
  return created;
}

async function ensureMembership(userId: string, organizationId: string, role: string) {
  const { error } = await admin
    .from("memberships")
    .upsert({ user_id: userId, organization_id: organizationId, role }, { onConflict: "user_id,organization_id" });
  if (error) throw error;
}

async function main() {
  console.log("Creating users...");
  const rahulId = await createUser("rahul@example.com", "Rahul");
  const priyaId = await createUser("priya@example.com", "Priya");

  console.log("Creating organizations...");
  const abcSteel = await getOrCreateOrg("ABC Steel", "abc-steel");
  const xyzMetals = await getOrCreateOrg("XYZ Metals", "xyz-metals");

  console.log("Creating memberships...");
  await ensureMembership(rahulId, abcSteel.id, "ADMIN");
  await ensureMembership(rahulId, xyzMetals.id, "VIEWER");
  await ensureMembership(priyaId, abcSteel.id, "REVIEWER");

  console.log("Creating sample invoices...");
  // One invoice in each status, so a reviewer opening the app for the first
  // time sees the full workflow immediately instead of empty screens. Totals
  // are computed by hand here the same way apps/api/src/lib/invoice-rules.ts
  // computes them at request time (round each line to 2dp, then sum) — kept
  // in sync manually since this script intentionally has no dependency on
  // the API package.
  type SeedLineItem = { description: string; quantity: number; rate: number; taxRate: number };

  function computeTotals(lineItems: SeedLineItem[]) {
    let taxableAmount = 0;
    let taxAmount = 0;
    const rows = lineItems.map((li) => {
      const lineTaxable = Math.round(li.quantity * li.rate * 100) / 100;
      const lineTax = Math.round(lineTaxable * (li.taxRate / 100) * 100) / 100;
      taxableAmount += lineTaxable;
      taxAmount += lineTax;
      return { ...li, amount: Math.round((lineTaxable + lineTax) * 100) / 100 };
    });
    taxableAmount = Math.round(taxableAmount * 100) / 100;
    taxAmount = Math.round(taxAmount * 100) / 100;
    return { rows, taxableAmount, taxAmount, totalAmount: Math.round((taxableAmount + taxAmount) * 100) / 100 };
  }

  async function createInvoice(params: {
    vendor: string;
    invoiceNumber: string;
    invoiceDate: string;
    status: "DRAFT" | "REVIEW" | "APPROVED" | "REJECTED";
    createdBy: string;
    approvedBy?: string;
    lineItems: SeedLineItem[];
  }) {
    const totals = computeTotals(params.lineItems);
    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .insert({
        organization_id: abcSteel.id,
        vendor: params.vendor,
        invoice_number: params.invoiceNumber,
        invoice_date: params.invoiceDate,
        status: params.status,
        taxable_amount: totals.taxableAmount,
        tax_amount: totals.taxAmount,
        total_amount: totals.totalAmount,
        created_by: params.createdBy,
        approved_by: params.approvedBy ?? null,
      })
      .select()
      .single();
    if (invErr) throw invErr;

    const { error: liErr } = await admin.from("line_items").insert(
      totals.rows.map((li) => ({
        invoice_id: invoice.id,
        description: li.description,
        quantity: li.quantity,
        rate: li.rate,
        tax_rate: li.taxRate,
        amount: li.amount,
      }))
    );
    if (liErr) throw liErr;

    // Seed a matching activity_log entry so the invoice's history isn't
    // empty — mirrors what the real API writes on each action.
    const actionByStatus = {
      DRAFT: "INVOICE_CREATED",
      REVIEW: "INVOICE_CREATED",
      APPROVED: "INVOICE_APPROVED",
      REJECTED: "INVOICE_REJECTED",
    } as const;
    await admin.from("activity_log").insert({
      organization_id: abcSteel.id,
      invoice_id: invoice.id,
      actor_id: params.approvedBy ?? params.createdBy,
      action: actionByStatus[params.status],
      metadata: { seed: true },
    });

    return invoice;
  }

  // Sample invoices are only meaningful the first time — if ABC Steel
  // already has any, assume a previous run already created them (re-running
  // would also fail on the (org, vendor, invoice_number) unique constraint,
  // but skipping up front gives a clearer message than a raw 23505).
  const { count: existingInvoiceCount, error: countError } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", abcSteel.id);
  if (countError) throw countError;

  if (existingInvoiceCount && existingInvoiceCount > 0) {
    console.log(`  ABC Steel already has ${existingInvoiceCount} invoice(s) — skipping sample invoice creation`);
  } else {
    await createInvoice({
      vendor: "Tata Metals",
      invoiceNumber: "TM-1001",
      invoiceDate: "2026-08-20",
      status: "DRAFT",
      createdBy: rahulId,
      lineItems: [{ description: "Cold-rolled steel sheet, 2mm", quantity: 40, rate: 850, taxRate: 18 }],
    });

    await createInvoice({
      vendor: "Atlantis Supplies",
      invoiceNumber: "6789",
      invoiceDate: "2026-08-25",
      status: "REVIEW",
      createdBy: rahulId,
      lineItems: [
        { description: "Structural angle bar, 50mm", quantity: 25, rate: 1600, taxRate: 18 },
        { description: "Freight and handling", quantity: 1, rate: 5000, taxRate: 18 },
      ],
    });

    await createInvoice({
      vendor: "XYZ Fabricators",
      invoiceNumber: "XYZ-2201",
      invoiceDate: "2026-08-10",
      status: "APPROVED",
      createdBy: rahulId,
      approvedBy: priyaId, // maker-checker: Priya approves what Rahul created
      lineItems: [{ description: "Galvanized pipe, 3-inch", quantity: 60, rate: 420, taxRate: 12 }],
    });

    await createInvoice({
      vendor: "Global Ironworks",
      invoiceNumber: "GI-0087",
      invoiceDate: "2026-08-05",
      status: "REJECTED",
      createdBy: rahulId,
      approvedBy: priyaId,
      lineItems: [{ description: "Duplicate delivery — billed in error", quantity: 1, rate: 12500, taxRate: 18 }],
    });
  }

  console.log("\nSeed complete.");
  console.log("Login as rahul@example.com or priya@example.com, password: password123");
  console.log(`ABC Steel org id: ${abcSteel.id}`);
  console.log(`XYZ Metals org id: ${xyzMetals.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    // Explicit exit rather than letting the process hang/crash on teardown —
    // works around a libuv assertion some Node builds hit on Windows when a
    // script exits from inside an async chain after network activity.
    process.exit(process.exitCode ?? 0);
  });
