// Regression tests for the senior-review findings fixed in
// supabase/migrations/0013_review_round_1_hardening.sql.
//
// Each test names the finding it protects. They run against a throwaway org
// (see helpers/test-org.ts) and, where it matters, assert the SPECIFIC error
// code — "some error happened" would also pass if everything were broken.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { buildApp } from "../../src/app";
import { createTestOrg, countOrgRows } from "../helpers/test-org";
import { createInvoiceRpc, transitionRpc, transitionAs, getInvoiceVersion } from "../helpers/invoices";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

async function loginAs(email: string): Promise<{ client: SupabaseClient; token: string; userId: string }> {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
  return { client, token: data.session!.access_token, userId: data.user!.id };
}

const app = buildApp({ logger: false });
let rahul: Awaited<ReturnType<typeof loginAs>>; // Admin in the test org
let yash: Awaited<ReturnType<typeof loginAs>>; // Reviewer in the test org
let testOrgId: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  await app.ready();
  const org = await createTestOrg("review-hardening");
  testOrgId = org.orgId;
  cleanup = org.cleanup;
  rahul = await loginAs("rahul@example.com");
  yash = await loginAs("yash@example.com");
});

afterAll(async () => {
  await cleanup();
  await app.close();
});

const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

describe("C1: invoices cannot be written to directly", () => {
  it("an Admin cannot INSERT a forged, already-approved invoice straight into the table", async () => {
    const before = await countOrgRows(testOrgId);

    const { data, error } = await rahul.client
      .from("invoices")
      .insert({
        organization_id: testOrgId,
        vendor: "Forged Vendor",
        invoice_number: uniq("FORGED"),
        invoice_date: "2026-01-01",
        status: "APPROVED",
        taxable_amount: 1,
        tax_amount: 0,
        total_amount: 1,
        created_by: yash.userId, // framing someone else as the maker
        approved_by: yash.userId,
      })
      .select();

    expect(data).toBeNull();
    expect(error?.code).toBe("42501"); // permission denied for table invoices

    const after = await countOrgRows(testOrgId);
    expect(after.invoices).toBe(before.invoices);
  });

  it("the sanctioned path still works for the same user", async () => {
    const { data, error } = await createInvoiceRpc(rahul.client, testOrgId, { invoiceNumber: uniq("OK") });
    expect(error).toBeNull();
    expect(data.status).toBe("DRAFT");
    expect(data.created_by).toBe(rahul.userId);
  });
});

describe("C2: memberships cannot be written to directly", () => {
  it("an Admin cannot UPDATE another member's role through the table", async () => {
    const { error } = await rahul.client
      .from("memberships")
      .update({ role: "VIEWER" })
      .eq("organization_id", testOrgId)
      .eq("user_id", yash.userId);
    expect(error?.code).toBe("42501");

    const { data } = await rahul.client
      .from("memberships")
      .select("role")
      .eq("organization_id", testOrgId)
      .eq("user_id", yash.userId)
      .single();
    expect(data?.role).toBe("REVIEWER"); // untouched
  });

  it("an Admin cannot DELETE another member through the table", async () => {
    const { error } = await rahul.client
      .from("memberships")
      .delete()
      .eq("organization_id", testOrgId)
      .eq("user_id", yash.userId);
    expect(error?.code).toBe("42501");

    const { data } = await rahul.client
      .from("memberships")
      .select("id")
      .eq("organization_id", testOrgId)
      .eq("user_id", yash.userId);
    expect(data).toHaveLength(1);
  });

  it("an Admin cannot INSERT a membership through the table", async () => {
    const { error } = await rahul.client
      .from("memberships")
      .insert({ organization_id: testOrgId, user_id: yash.userId, role: "ADMIN" });
    expect(error?.code).toBe("42501");
  });

  it("members can still READ their own organisation's memberships", async () => {
    const { data, error } = await rahul.client.from("memberships").select("user_id").eq("organization_id", testOrgId);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("anon role has no access to internal functions", () => {
  it("an unauthenticated client cannot call transition_invoice", async () => {
    const anon = createClient(url, anonKey);
    const { error } = await anon.rpc("transition_invoice", {
      p_invoice_id: "00000000-0000-0000-0000-000000000001",
      p_to_status: "REVIEW",
      p_expected_version: 1,
    });
    // Postgres says 42501 (permission denied); depending on the PostgREST
    // version the call may instead be reported as PGRST202 (not in the schema
    // cache for this role). Either way it is refused — what must NOT happen is
    // `error === null`.
    expect(error).not.toBeNull();
    expect(["42501", "PGRST202"]).toContain(error!.code);
  });
});

describe("H1: approving requires the version the reviewer actually saw", () => {
  async function invoiceInReview(): Promise<{ id: string; reviewerSawVersion: number }> {
    const { data, error } = await createInvoiceRpc(rahul.client, testOrgId, { invoiceNumber: uniq("STALE") });
    if (error) throw error;
    const submit = await transitionRpc(rahul.client, data.id, "REVIEW");
    if (submit.error) throw submit.error;
    return { id: data.id, reviewerSawVersion: submit.data.version };
  }

  async function editAsRahul(invoiceId: string, version: number, rate: number) {
    return rahul.client.rpc("update_invoice", {
      p_organization_id: testOrgId,
      p_invoice_id: invoiceId,
      p_expected_version: version,
      p_patch: { lineItems: [{ description: "Widget", quantity: 1, rate, taxRate: 0 }] },
    });
  }

  it("database: approval with a stale version is refused and the invoice stays in Review", async () => {
    const { id, reviewerSawVersion } = await invoiceInReview();
    // The reviewer has the page open at `reviewerSawVersion`; the maker then
    // changes the amount from 1000 to 9,000,000 while it is still in Review.
    const edit = await editAsRahul(id, reviewerSawVersion, 9_000_000);
    expect(edit.error).toBeNull();

    const stale = await transitionRpc(yash.client, id, "APPROVED", reviewerSawVersion);
    expect(stale.error?.code).toBe("PT409");

    const { data } = await yash.client.from("invoices").select("status").eq("id", id).single();
    expect(data?.status).toBe("REVIEW");

    // After reloading (current version) the same reviewer can approve.
    const fresh = await transitionRpc(yash.client, id, "APPROVED");
    expect(fresh.error).toBeNull();
    expect(fresh.data.status).toBe("APPROVED");
  });

  it("HTTP: the same stale approval is a 409 VERSION_CONFLICT, not a 500", async () => {
    const { id, reviewerSawVersion } = await invoiceInReview();
    await editAsRahul(id, reviewerSawVersion, 7_000_000);

    const res = await transitionAs(app, testOrgId, id, yash.token, "APPROVED", reviewerSawVersion);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");

    const current = await getInvoiceVersion(app, testOrgId, id, yash.token);
    const ok = await transitionAs(app, testOrgId, id, yash.token, "APPROVED", current);
    expect(ok.statusCode).toBe(200);
  });

  it("HTTP: a transition without expectedVersion is rejected with 400", async () => {
    const { id } = await invoiceInReview();
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices/${id}/transition`,
      headers: { authorization: `Bearer ${yash.token}` },
      payload: { toStatus: "APPROVED" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("M2: blank text is rejected at every layer", () => {
  it("database: whitespace-only vendor, invoice number and description are all refused", async () => {
    const blankVendor = await createInvoiceRpc(rahul.client, testOrgId, { vendor: "   ", invoiceNumber: uniq("B") });
    expect(blankVendor.error?.code).toBe("22023");

    const blankNumber = await createInvoiceRpc(rahul.client, testOrgId, { invoiceNumber: "   " });
    expect(blankNumber.error?.code).toBe("22023");

    const blankDescription = await createInvoiceRpc(rahul.client, testOrgId, {
      invoiceNumber: uniq("B"),
      lineItems: [{ description: "   ", quantity: 1, rate: 1, taxRate: 0 }],
    });
    expect(blankDescription.error?.code).toBe("22023");
  });

  it("API: the same payloads are 400s", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices`,
      headers: { authorization: `Bearer ${rahul.token}` },
      payload: {
        vendor: "   ",
        invoiceNumber: uniq("B"),
        invoiceDate: "2026-01-15",
        lineItems: [{ description: "Widget", quantity: 1, rate: 1, taxRate: 0 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("stored values are trimmed", async () => {
    const n = uniq("TRIM");
    const { data, error } = await createInvoiceRpc(rahul.client, testOrgId, {
      vendor: "  Padded Vendor  ",
      invoiceNumber: `  ${n}  `,
      lineItems: [{ description: "  spaced  ", quantity: 1, rate: 1, taxRate: 0 }],
    });
    expect(error).toBeNull();
    expect(data.vendor).toBe("Padded Vendor");
    expect(data.invoice_number).toBe(n);
    expect(data.lineItems[0].description).toBe("spaced");
  });
});

describe("audit: an edit records what changed in money terms", () => {
  it("INVOICE_EDITED metadata includes the total before and after", async () => {
    const { data: inv } = await createInvoiceRpc(rahul.client, testOrgId, {
      invoiceNumber: uniq("AUD"),
      lineItems: [{ description: "Widget", quantity: 1, rate: 1000, taxRate: 18 }], // total 1180
    });
    const edit = await rahul.client.rpc("update_invoice", {
      p_organization_id: testOrgId,
      p_invoice_id: inv.id,
      p_expected_version: inv.version,
      p_patch: { lineItems: [{ description: "Widget", quantity: 1, rate: 5000, taxRate: 18 }] }, // total 5900
    });
    expect(edit.error).toBeNull();

    const { data: entries } = await rahul.client
      .from("activity_log")
      .select("metadata")
      .eq("invoice_id", inv.id)
      .eq("action", "INVOICE_EDITED");
    expect(entries).toHaveLength(1);
    const m = entries![0].metadata;
    expect(Number(m.totalBefore)).toBe(1180);
    expect(Number(m.totalAfter)).toBe(5900);
    expect(m.status).toBe("DRAFT");
    expect(m.changedFields).toEqual(["lineItems"]);
  });
});
