// Run with: npx tsx scripts/seed.ts
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
// (service role key only — never expose this key to the frontend)
//
// Idempotent: safe to run against a project that's already (partially)
// seeded. Users, organizations, and memberships are looked up / upserted
// instead of blindly inserted, and the sample invoices for a given org are
// only created once (skipped entirely if that org already has any).
//
// NOTE on Priya: earlier versions of this script created priya@example.com
// as ABC Steel's Reviewer. She has been retired in favor of Yash (see
// below) — this script no longer creates her. If your database was seeded
// by an older version of this script, her profile/auth user will still
// exist until removed by hand (or via `supabase db reset` on a project you
// don't mind wiping) — this script does not delete existing users, since
// she may still be referenced by invoices' `approved_by` column via a
// foreign key that would need those invoices reassigned or removed first.

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
// `npm run seed` reads .env (your normal project); `npm run seed:test` passes
// --env=.env.test so a throwaway TEST project can be seeded without touching
// the real one. Whichever is used, the target is printed before anything runs.
const envArg = process.argv.find((a) => a.startsWith("--env="));
dotenv.config({ path: envArg ? envArg.slice("--env=".length) : ".env" });

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

console.log(`Seeding Supabase project: ${supabaseUrl ? new URL(supabaseUrl).host : "(SUPABASE_URL not set)"}`);
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

// Totals are computed by hand here the same way apps/api/src/lib/invoice-rules.ts
// computes them at request time (round each line to 2dp, then sum) — kept in
// sync manually since this script intentionally has no dependency on the API
// package.
type SeedLineItem = { description: string; quantity: number; rate: number; taxRate: number };
type SeedStatus = "DRAFT" | "REVIEW" | "APPROVED" | "REJECTED";

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
  organizationId: string;
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: SeedStatus;
  createdBy: string;
  approvedBy?: string;
  lineItems: SeedLineItem[];
}) {
  const totals = computeTotals(params.lineItems);
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .insert({
      organization_id: params.organizationId,
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
  const actionByStatus: Record<SeedStatus, "INVOICE_CREATED" | "INVOICE_APPROVED" | "INVOICE_REJECTED"> = {
    DRAFT: "INVOICE_CREATED",
    REVIEW: "INVOICE_CREATED",
    APPROVED: "INVOICE_APPROVED",
    REJECTED: "INVOICE_REJECTED",
  };
  await admin.from("activity_log").insert({
    organization_id: params.organizationId,
    invoice_id: invoice.id,
    actor_id: params.approvedBy ?? params.createdBy,
    action: actionByStatus[params.status],
    metadata: { seed: true },
  });

  return invoice;
}

async function orgAlreadyHasInvoices(organizationId: string): Promise<boolean> {
  const { count, error } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (error) throw error;
  return !!count && count > 0;
}

async function main() {
  console.log("Creating users...");
  const rahulId = await createUser("rahul@example.com", "Rahul");
  // Replaces Priya as ABC Steel's Reviewer, and is separately Admin of his
  // own org (Yash Textiles) below — same pattern as Rahul holding different
  // roles in different orgs on the same account.
  const yashId = await createUser("yash@example.com", "Yash");
  const nehaId = await createUser("neha@example.com", "Neha");
  const arjunId = await createUser("arjun@example.com", "Arjun");
  const meeraId = await createUser("meera@example.com", "Meera");
  const karanId = await createUser("karan@example.com", "Karan");

  console.log("Creating organizations...");
  const abcSteel = await getOrCreateOrg("ABC Steel", "abc-steel");
  const xyzMetals = await getOrCreateOrg("XYZ Metals", "xyz-metals");
  const yashTextiles = await getOrCreateOrg("Yash Textiles", "yash-textiles");
  const coastalLogistics = await getOrCreateOrg("Coastal Logistics", "coastal-logistics");
  const meeraExports = await getOrCreateOrg("Meera Exports", "meera-exports");
  const sunriseTraders = await getOrCreateOrg("Sunrise Traders", "sunrise-traders");

  console.log("Creating memberships...");
  // ABC Steel — same narrative as before, with Yash now standing in for
  // Priya as the org's Reviewer (maker-checker: Rahul creates, Yash decides).
  await ensureMembership(rahulId, abcSteel.id, "ADMIN");
  await ensureMembership(rahulId, xyzMetals.id, "VIEWER");
  await ensureMembership(yashId, abcSteel.id, "REVIEWER");

  // Yash Textiles — Yash's own org, where he's Admin. Neha is the Reviewer
  // who approves/rejects what Yash creates (maker-checker requires someone
  // other than Yash). Arjun is an Operator so there's a third role present.
  await ensureMembership(yashId, yashTextiles.id, "ADMIN");
  await ensureMembership(nehaId, yashTextiles.id, "REVIEWER");
  await ensureMembership(arjunId, yashTextiles.id, "OPERATOR");

  // A handful of smaller orgs so there are 6 total and several users belong
  // to more than one, the way real multi-tenant accounts look.
  await ensureMembership(arjunId, coastalLogistics.id, "ADMIN");
  await ensureMembership(meeraId, coastalLogistics.id, "REVIEWER");

  await ensureMembership(meeraId, meeraExports.id, "ADMIN");
  await ensureMembership(karanId, meeraExports.id, "OPERATOR");
  await ensureMembership(nehaId, meeraExports.id, "REVIEWER");

  await ensureMembership(karanId, sunriseTraders.id, "ADMIN");
  await ensureMembership(rahulId, sunriseTraders.id, "VIEWER");

  console.log("Creating sample invoices...");

  // ABC Steel: unchanged narrative — one invoice in each status — except
  // the two decided ones are now approved/rejected by Yash instead of Priya.
  if (await orgAlreadyHasInvoices(abcSteel.id)) {
    console.log("  ABC Steel already has invoices — skipping sample invoice creation");
  } else {
    await createInvoice({
      organizationId: abcSteel.id,
      vendor: "Tata Metals",
      invoiceNumber: "TM-1001",
      invoiceDate: "2026-08-20",
      status: "DRAFT",
      createdBy: rahulId,
      lineItems: [{ description: "Cold-rolled steel sheet, 2mm", quantity: 40, rate: 850, taxRate: 18 }],
    });

    await createInvoice({
      organizationId: abcSteel.id,
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
      organizationId: abcSteel.id,
      vendor: "XYZ Fabricators",
      invoiceNumber: "XYZ-2201",
      invoiceDate: "2026-08-10",
      status: "APPROVED",
      createdBy: rahulId,
      approvedBy: yashId, // maker-checker: Yash approves what Rahul created
      lineItems: [{ description: "Galvanized pipe, 3-inch", quantity: 60, rate: 420, taxRate: 12 }],
    });

    await createInvoice({
      organizationId: abcSteel.id,
      vendor: "Global Ironworks",
      invoiceNumber: "GI-0087",
      invoiceDate: "2026-08-05",
      status: "REJECTED",
      createdBy: rahulId,
      approvedBy: yashId,
      lineItems: [{ description: "Duplicate delivery — billed in error", quantity: 1, rate: 12500, taxRate: 18 }],
    });
  }

  // Yash Textiles: the bulk demo dataset — 24 invoices spread evenly across
  // all four statuses, so pagination, search, filtering, and the org's
  // summary widgets all have real, varied data to show. Yash creates every
  // one of them (he's the org's Admin, acting as maker here); Neha decides
  // the ones that have left Review, exactly as the maker-checker rule
  // requires (approver can never be the creator).
  if (await orgAlreadyHasInvoices(yashTextiles.id)) {
    console.log("  Yash Textiles already has invoices — skipping sample invoice creation");
  } else {
    const vendors = [
      "Ganges Textile Mills",
      "Rajesh Dyeing Works",
      "Om Sai Fabrics",
      "Surat Silk Traders",
      "Bharat Cotton Corp",
      "Vinayak Weaving Co",
      "Shree Ram Textiles",
      "Indus Garment Supplies",
    ];
    const descriptions = [
      "Cotton yarn, 40s count",
      "Polyester blend fabric, 60-inch width",
      "Dyeing and finishing services",
      "Printed fabric roll, 100m",
      "Embroidery work, per piece",
      "Denim fabric, 12oz",
      "Silk saree material, per meter",
      "Packing and freight",
    ];
    const taxRates = [5, 12, 18];

    // 6 in each status, 24 total.
    const plan: { status: SeedStatus; decided: boolean }[] = [
      ...Array(6).fill({ status: "DRAFT" as const, decided: false }),
      ...Array(6).fill({ status: "REVIEW" as const, decided: false }),
      ...Array(6).fill({ status: "APPROVED" as const, decided: true }),
      ...Array(6).fill({ status: "REJECTED" as const, decided: true }),
    ];

    for (let i = 0; i < plan.length; i++) {
      const { status, decided } = plan[i];
      const vendor = vendors[i % vendors.length];
      const quantity = 10 + ((i * 7) % 40); // varies 10-49
      const rate = 150 + ((i * 53) % 900); // varies 150-1049
      const taxRate = taxRates[i % taxRates.length];
      // Spread invoice dates across the second half of 2026.
      const day = 1 + (i % 28);
      const month = 3 + (i % 6); // March .. August
      const invoiceDate = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      await createInvoice({
        organizationId: yashTextiles.id,
        vendor,
        invoiceNumber: `YT-${2001 + i}`,
        invoiceDate,
        status,
        createdBy: yashId,
        approvedBy: decided ? nehaId : undefined,
        lineItems: [
          { description: descriptions[i % descriptions.length], quantity, rate, taxRate },
          { description: "Freight and handling", quantity: 1, rate: 500 + (i % 5) * 100, taxRate },
        ],
      });
    }
  }

  console.log("\nSeed complete.");
  console.log("Users (all password: password123):");
  console.log("  rahul@example.com   - Admin @ ABC Steel, Viewer @ XYZ Metals & Sunrise Traders");
  console.log("  yash@example.com    - Reviewer @ ABC Steel, Admin @ Yash Textiles");
  console.log("  neha@example.com    - Reviewer @ Yash Textiles & Meera Exports");
  console.log("  arjun@example.com   - Operator @ Yash Textiles, Admin @ Coastal Logistics");
  console.log("  meera@example.com   - Reviewer @ Coastal Logistics, Admin @ Meera Exports");
  console.log("  karan@example.com   - Operator @ Meera Exports, Admin @ Sunrise Traders");
  console.log(`\nABC Steel org id: ${abcSteel.id}`);
  console.log(`XYZ Metals org id: ${xyzMetals.id}`);
  console.log(`Yash Textiles org id: ${yashTextiles.id} (24 sample invoices, 6 per status)`);
  console.log(`Coastal Logistics org id: ${coastalLogistics.id}`);
  console.log(`Meera Exports org id: ${meeraExports.id}`);
  console.log(`Sunrise Traders org id: ${sunriseTraders.id}`);
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
