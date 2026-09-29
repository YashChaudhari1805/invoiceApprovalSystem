// Any test that actually CREATES data (invoices, membership changes) should
// run against a throwaway org from this helper, not the real seeded
// ABC Steel/XYZ Metals orgs — those are meant to stay clean, matching the
// assignment's own example data, for anyone demoing the app afterward.
// Tests that only READ or attempt (and expect to fail) a write against the
// real seeded orgs — e.g. tenant-isolation checks — are fine using them
// directly, since they don't leave residue.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Service-role client: used ONLY here, for test setup/teardown that needs to
// bypass RLS (creating an org and seeding its memberships before any test
// user actually has access to it yet). Never used to drive the actual
// behavior under test — that always goes through the app/RLS-scoped clients.
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

// A second Reviewer, on top of Yash, that exists purely for concurrency
// tests that need two *different* non-creator reviewers acting on the same
// invoice at once (e.g. Approve vs Reject) — Yash alone isn't enough for
// that since one request needs to come from someone other than him too.
// Created lazily via the admin client the first time a test asks for it, so
// it never has to be part of the demo-facing `npm run seed` data.
export const TEST_REVIEWER_EMAIL = "test-reviewer@example.com";
export const TEST_REVIEWER_PASSWORD = "password123";

async function ensureTestReviewer(): Promise<string> {
  const { data: existing } = await admin.from("profiles").select("id").eq("email", TEST_REVIEWER_EMAIL).maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_REVIEWER_EMAIL,
    password: TEST_REVIEWER_PASSWORD,
    email_confirm: true,
    user_metadata: { name: "Test Reviewer" },
  });
  if (error) {
    // Lost a race with another test file/worker creating the same user
    // concurrently — just look it up instead of failing.
    const { data: raced } = await admin.from("profiles").select("id").eq("email", TEST_REVIEWER_EMAIL).maybeSingle();
    if (raced) return raced.id;
    throw error;
  }
  return data.user.id;
}

export interface TestOrg {
  orgId: string;
  cleanup: () => Promise<void>;
}

export async function createTestOrg(namePrefix: string): Promise<TestOrg> {
  const { data: rahul } = await admin.from("profiles").select("id").eq("email", "rahul@example.com").single();
  const { data: yash } = await admin.from("profiles").select("id").eq("email", "yash@example.com").single();
  if (!rahul || !yash) {
    throw new Error("Seed users not found — run `npm run seed` before running tests.");
  }
  const testReviewerId = await ensureTestReviewer();

  const slug = `${namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `Test Org (${namePrefix})`, slug })
    .select("id")
    .single();
  if (orgError) throw orgError;

  const { error: memError } = await admin.from("memberships").insert([
    { user_id: rahul.id, organization_id: org.id, role: "ADMIN" },
    { user_id: yash.id, organization_id: org.id, role: "REVIEWER" },
    { user_id: testReviewerId, organization_id: org.id, role: "REVIEWER" },
  ]);
  if (memError) throw memError;

  return {
    orgId: org.id,
    // Deleting the org cascades to memberships, invoices, line_items, and
    // activity_log (all ON DELETE CASCADE from organization_id) — one
    // delete cleans up everything this test file created.
    cleanup: async () => {
      await admin.from("organizations").delete().eq("id", org.id);
    },
  };
}

// Read-only observation helper for atomicity tests. Counts what is actually
// persisted for an org via the service-role client, which bypasses RLS — so a
// leftover row can't be hidden from the assertion by a row-level policy.
// Never used to drive behavior under test, only to inspect its aftermath.
export async function countOrgRows(orgId: string) {
  const [invoices, lineItems, activity] = await Promise.all([
    admin.from("invoices").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    admin
      .from("line_items")
      .select("id, invoices!inner(organization_id)", { count: "exact", head: true })
      .eq("invoices.organization_id", orgId),
    admin.from("activity_log").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
  ]);
  for (const r of [invoices, lineItems, activity]) if (r.error) throw r.error;
  return { invoices: invoices.count ?? 0, lineItems: lineItems.count ?? 0, activity: activity.count ?? 0 };
}

// TEST-ONLY, service-role only (see 0009_lockdown_and_audit.sql): runs
// create_invoice() impersonating p_actor with the activity_log insert
// broken for that one call, so tests can prove "audit insert fails -> the
// whole operation rolls back" against the real database. The failure is
// scoped to this one call's own transaction (see the migration's comments
// for why that's safe to run alongside every other concurrently-running
// test in this suite).
export async function createInvoiceWithBrokenAudit(
  actorId: string,
  organizationId: string,
  vendor: string,
  invoiceNumber: string,
  invoiceDate: string,
  lineItems: unknown[]
) {
  return admin.rpc("test_create_invoice_with_broken_audit", {
    p_actor: actorId,
    p_organization_id: organizationId,
    p_vendor: vendor,
    p_invoice_number: invoiceNumber,
    p_invoice_date: invoiceDate,
    p_line_items: lineItems,
  });
}
