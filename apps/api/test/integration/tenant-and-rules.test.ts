// These tests hit your REAL Supabase project as Rahul and Yash (the seeded
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
import { createInvoiceRpc, transitionRpc } from "../helpers/invoices";
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
let yash: SupabaseClient; // Reviewer @ ABC Steel
let abcSteelId: string; // real seeded org — used only where nothing gets written
let xyzMetalsId: string;

beforeAll(async () => {
  rahul = await loginAs("rahul@example.com");
  yash = await loginAs("yash@example.com");

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
    // Yash has no membership at XYZ Metals. Even asking directly for XYZ Metals'
    // invoices by organization_id, RLS should return nothing — not an error,
    // just zero rows, because the policy filters at the row level.
    const { data, error } = await yash
      .from("invoices")
      .select("id")
      .eq("organization_id", xyzMetalsId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a user cannot create an invoice in an org they don't belong to", async () => {
    // Yash has no membership in XYZ Metals. create_invoice() must refuse with
    // "forbidden" (42501) specifically — not merely "some error".
    const { data, error } = await createInvoiceRpc(yash, xyzMetalsId, { invoiceNumber: `RLS-TEST-${Date.now()}` });
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

});

describe("role-scoped access", () => {
  it("Rahul is Viewer at XYZ Metals and cannot create an invoice there", async () => {
    // Same person, Admin elsewhere: the role is per-organization.
    const { data, error } = await createInvoiceRpc(rahul, xyzMetalsId, { invoiceNumber: `VIEWER-TEST-${Date.now()}` });
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
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

    const { data: created, error } = await createInvoiceRpc(rahul, testOrgId, {
      vendor: "Tata Metals",
      invoiceNumber,
    });
    if (error) throw error;
    invoiceId = created.id;

    // move it to REVIEW so approval is a valid next transition
    const { error: transErr } = await transitionRpc(rahul, invoiceId, "REVIEW");
    if (transErr) throw transErr;
  });

  afterAll(async () => {
    await cleanupTestOrg();
  });

  it("blocks Rahul from approving his own invoice, even as Admin", async () => {
    const { error } = await transitionRpc(rahul, invoiceId, "APPROVED");
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/cannot approve or reject an invoice you created/i);
  });

  it("allows Yash (a different Reviewer) to approve it", async () => {
    const { data, error } = await transitionRpc(yash, invoiceId, "APPROVED");
    expect(error).toBeNull();
    expect(data.status).toBe("APPROVED");
  });

  it("rejects an invalid transition out of a terminal state", async () => {
    const { error } = await transitionRpc(yash, invoiceId, "REVIEW");
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/invalid status transition/i);
  });
});

describe("self-membership protection (RLS)", () => {
  let testOrgId: string;
  let cleanupTestOrg: () => Promise<void>;

  beforeAll(async () => {
    const testOrg = await createTestOrg("self-membership");
    testOrgId = testOrg.orgId;
    cleanupTestOrg = testOrg.cleanup;
  });

  afterAll(async () => {
    await cleanupTestOrg();
  });

  it("blocks an Admin from updating their own membership row directly, bypassing the API entirely", async () => {
    const rahulId = (await rahul.auth.getUser()).data.user!.id;
    const { error } = await rahul
      .from("memberships")
      .update({ role: "VIEWER" })
      .eq("organization_id", testOrgId)
      .eq("user_id", rahulId);
    // RLS silently matches zero rows rather than erroring, so we confirm by
    // re-reading rather than relying on `error` alone.
    expect(error).toBeNull();

    const { data } = await rahul
      .from("memberships")
      .select("role")
      .eq("organization_id", testOrgId)
      .eq("user_id", rahulId)
      .single();
    expect(data!.role).toBe("ADMIN");
  });

  it("blocks an Admin from deleting their own membership row directly", async () => {
    const rahulId = (await rahul.auth.getUser()).data.user!.id;
    await rahul.from("memberships").delete().eq("organization_id", testOrgId).eq("user_id", rahulId);

    const { data } = await rahul
      .from("memberships")
      .select("role")
      .eq("organization_id", testOrgId)
      .eq("user_id", rahulId)
      .single();
    expect(data).not.toBeNull(); // still there
  });
});

describe("duplicate protection", () => {
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

  it("only one of two simultaneous identical creates succeeds", async () => {
    const invoiceNumber = `DUP-TEST-${Date.now()}`;
    const results = await Promise.all([
      createInvoiceRpc(rahul, testOrgId, { vendor: "Tata Metals", invoiceNumber }),
      createInvoiceRpc(rahul, testOrgId, { vendor: "Tata Metals", invoiceNumber }),
    ]);

    const succeeded = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].error?.code).toBe("23505"); // unique violation, not some other failure
  });

  it("treats vendor and invoice number as the same regardless of case or surrounding spaces", async () => {
    const n = Date.now();
    const first = await createInvoiceRpc(rahul, testOrgId, { vendor: "Tata Metals", invoiceNumber: `TM-${n}` });
    expect(first.error).toBeNull();

    for (const [vendor, invoiceNumber] of [
      ["tata metals", `TM-${n}`],
      ["TATA METALS", `tm-${n}`],
      ["  Tata Metals  ", `  TM-${n}  `],
    ]) {
      const dup = await createInvoiceRpc(rahul, testOrgId, { vendor, invoiceNumber });
      expect(dup.error?.code, `"${vendor}" / "${invoiceNumber}" should be a duplicate`).toBe("23505");
    }

    // A genuinely different vendor with the same number is still allowed.
    const other = await createInvoiceRpc(rahul, testOrgId, { vendor: "Tata Steel", invoiceNumber: `TM-${n}` });
    expect(other.error).toBeNull();
  });
});
