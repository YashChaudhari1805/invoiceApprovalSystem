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

export interface TestOrg {
  orgId: string;
  cleanup: () => Promise<void>;
}

export async function createTestOrg(namePrefix: string): Promise<TestOrg> {
  const { data: rahul } = await admin.from("profiles").select("id").eq("email", "rahul@example.com").single();
  const { data: priya } = await admin.from("profiles").select("id").eq("email", "priya@example.com").single();
  if (!rahul || !priya) {
    throw new Error("Seed users not found — run `npm run seed` before running tests.");
  }

  const slug = `${namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `Test Org (${namePrefix})`, slug })
    .select("id")
    .single();
  if (orgError) throw orgError;

  const { error: memError } = await admin.from("memberships").insert([
    { user_id: rahul.id, organization_id: org.id, role: "ADMIN" },
    { user_id: priya.id, organization_id: org.id, role: "REVIEWER" },
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
