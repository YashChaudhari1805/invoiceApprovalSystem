// These tests hit your REAL Supabase project as Rahul and Priya (the seeded
// users) — no mocking. They verify the database layer itself (RLS policies +
// transition_invoice function) enforces the rules, independent of whatever
// the Fastify API code does or doesn't check. This is deliberate: if these
// pass, cross-tenant access and maker-checker violations are impossible even
// if the API layer above has a bug.
//
// Requires .env with SUPABASE_URL / SUPABASE_ANON_KEY and the seeded users
// from `npm run seed` to exist. Run with: npx vitest run test/integration

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createTestOrg } from "../helpers/test-org";
// env vars are loaded by test/setup.ts (see vitest.config.ts's setupFiles)
// before this file is imported

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

async function loginAs(email: string): Promise<SupabaseClient> {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Failed to log in as ${email}: ${error.message}`);
  return client;
}

let rahul: SupabaseClient; // Admin @ ABC Steel, Viewer @ XYZ Metals
let priya: SupabaseClient; // Reviewer @ ABC Steel
let abcSteelId: string; // real seeded org — used only where nothing gets written
let xyzMetalsId: string;

beforeAll(async () => {
  rahul = await loginAs("rahul@example.com");
  priya = await loginAs("priya@example.com");

  const { data: orgs } = await rahul.from("organizations").select("id, slug");
  abcSteelId = orgs!.find((o) => o.slug === "abc-steel")!.id;
  xyzMetalsId = orgs!.find((o) => o.slug === "xyz-metals")!.id;
});

describe("tenant isolation (RLS)", () => {
  it("Rahul sees both orgs he's a member of", async () => {
    const { data } = await rahul.from("organizations").select("id");
    const ids = data!.map((o) => o.id);
    expect(ids).toContain(abcSteelId);
    expect(ids).toContain(xyzMetalsId);
  });

  it("a user cannot read invoices from an org they don't belong to", async () => {
    // Priya only belongs to ABC Steel. Even asking directly for XYZ Metals'
    // invoices by organization_id, RLS should return nothing — not an error,
    // just zero rows, because the policy filters at the row level.
    const { data, error } = await priya
      .from("invoices")
      .select("id")
      .eq("organization_id", xyzMetalsId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a user cannot insert an invoice into an org they don't belong to", async () => {
    const { error } = await priya.from("invoices").insert({
      organization_id: xyzMetalsId,
      vendor: "Test Vendor",
      invoice_number: `RLS-TEST-${Date.now()}`,
      invoice_date: "2026-01-01",
      taxable_amount: 100,
      tax_amount: 18,
      total_amount: 118,
      created_by: (await priya.auth.getUser()).data.user!.id,
    });
    expect(error).not.toBeNull(); // RLS policy should reject this insert
  });
});

describe("role-scoped access", () => {
  it("Rahul is Viewer at XYZ Metals and cannot create an invoice there", async () => {
    const { error } = await rahul.from("invoices").insert({
      organization_id: xyzMetalsId,
      vendor: "Test Vendor",
      invoice_number: `VIEWER-TEST-${Date.now()}`,
      invoice_date: "2026-01-01",
      taxable_amount: 100,
      tax_amount: 18,
      total_amount: 118,
      created_by: (await rahul.auth.getUser()).data.user!.id,
    });
    expect(error).not.toBeNull(); // insert policy requires ADMIN or OPERATOR
  });
});

describe("maker-checker + workflow (transition_invoice RPC)", () => {
  let invoiceId: string;
  let testOrgId: string;
  let cleanupTestOrg: () => Promise<void>;
  const invoiceNumber = `MK-TEST-${Date.now()}`;

  beforeAll(async () => {
    const testOrg = await createTestOrg("maker-checker");
    testOrgId = testOrg.orgId;
    cleanupTestOrg = testOrg.cleanup;

    const rahulId = (await rahul.auth.getUser()).data.user!.id;
    const { data, error } = await rahul
      .from("invoices")
      .insert({
        organization_id: testOrgId,
        vendor: "Tata Metals",
        invoice_number: invoiceNumber,
        invoice_date: "2026-01-01",
        taxable_amount: 1000,
        tax_amount: 180,
        total_amount: 1180,
        created_by: rahulId,
      })
      .select()
      .single();
    if (error) throw error;
    invoiceId = data.id;

    // move it to REVIEW so approval is a valid next transition
    const { error: transErr } = await rahul.rpc("transition_invoice", {
      p_invoice_id: invoiceId,
      p_to_status: "REVIEW",
    });
    if (transErr) throw transErr;
  });

  afterAll(async () => {
    await cleanupTestOrg();
  });

  it("blocks Rahul from approving his own invoice, even as Admin", async () => {
    const { error } = await rahul.rpc("transition_invoice", {
      p_invoice_id: invoiceId,
      p_to_status: "APPROVED",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/cannot approve or reject an invoice you created/i);
  });

  it("allows Priya (a different Reviewer) to approve it", async () => {
    const { data, error } = await priya.rpc("transition_invoice", {
      p_invoice_id: invoiceId,
      p_to_status: "APPROVED",
    });
    expect(error).toBeNull();
    expect(data.status).toBe("APPROVED");
  });

  it("rejects an invalid transition out of a terminal state", async () => {
    const { error } = await priya.rpc("transition_invoice", {
      p_invoice_id: invoiceId,
      p_to_status: "REVIEW",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/invalid status transition/i);
  });
});

describe("duplicate invoice protection under concurrency", () => {
  let testOrgId: string;
  let cleanupTestOrg: () => Promise<void>;

  beforeAll(async () => {
    const testOrg = await createTestOrg("dup-protection");
    testOrgId = testOrg.orgId;
    cleanupTestOrg = testOrg.cleanup;
  });

  afterAll(async () => {
    await cleanupTestOrg();
  });

  it("only one of two simultaneous identical-invoice inserts succeeds", async () => {
    const rahulId = (await rahul.auth.getUser()).data.user!.id;
    const invoiceNumber = `DUP-TEST-${Date.now()}`;
    const payload = {
      organization_id: testOrgId,
      vendor: "Tata Metals",
      invoice_number: invoiceNumber,
      invoice_date: "2026-01-01",
      taxable_amount: 500,
      tax_amount: 90,
      total_amount: 590,
      created_by: rahulId,
    };

    const results = await Promise.allSettled([
      rahul.from("invoices").insert(payload),
      rahul.from("invoices").insert(payload),
    ]);

    const errors = results.map((r) => (r.status === "fulfilled" ? r.value.error : r.reason));
    const succeeded = errors.filter((e) => e === null).length;
    const failed = errors.filter((e) => e !== null).length;

    expect(succeeded).toBe(1);
    expect(failed).toBe(1);
  });
});
