import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../../src/app";
import { createTestOrg, TEST_REVIEWER_EMAIL } from "../helpers/test-org";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

async function loginAs(email: string) {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
  return { token: data.session!.access_token, userId: data.user!.id };
}

const app = buildApp({ logger: false });
let rahulToken: string;
let yashToken: string;
let testReviewerToken: string;
let testOrgId: string;
let cleanupTestOrg: () => Promise<void>;

beforeAll(async () => {
  await app.ready();
  const rahul = await loginAs("rahul@example.com");
  const yash = await loginAs("yash@example.com");
  rahulToken = rahul.token;
  yashToken = yash.token;

  const testOrg = await createTestOrg("invoices-detail-transition");
  testOrgId = testOrg.orgId;
  cleanupTestOrg = testOrg.cleanup;

  // Logged in last, after createTestOrg() has made sure this user exists.
  const testReviewer = await loginAs(TEST_REVIEWER_EMAIL);
  testReviewerToken = testReviewer.token;
});

afterAll(async () => {
  await cleanupTestOrg();
  await app.close();
});

async function createInvoiceAs(token: string) {
  const res = await app.inject({
    method: "POST",
    url: `/orgs/${testOrgId}/invoices`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      vendor: "Detail Test Vendor",
      invoiceNumber: `DETAIL-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      invoiceDate: "2026-01-15",
      lineItems: [{ description: "Widget", quantity: 1, rate: 500, taxRate: 18 }],
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function createInvoiceAsRahul() {
  return createInvoiceAs(rahulToken);
}

describe("GET /orgs/:orgId/invoices/:invoiceId", () => {
  it("returns invoice info, line items, and activity", async () => {
    const invoiceId = await createInvoiceAsRahul();
    const res = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(invoiceId);
    expect(body.lineItems).toHaveLength(1);
    expect(body.activity.length).toBeGreaterThanOrEqual(1);
    expect(body.activity[0].action).toBe("INVOICE_CREATED");
  });

  it("Draft invoice offers SUBMIT_FOR_REVIEW to its Admin creator", async () => {
    const invoiceId = await createInvoiceAsRahul();
    const res = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.json().availableActions).toContain("SUBMIT_FOR_REVIEW");
  });

  it("returns 404 for a nonexistent invoice id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/invoices/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("includes the creator's name", async () => {
    const invoiceId = await createInvoiceAsRahul();
    const res = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.json().creator.name).toBe("Rahul");
  });
});

describe("GET /orgs/:orgId/activity", () => {
  it("lists org-wide activity including who performed each action", async () => {
    const invoiceId = await createInvoiceAsRahul();
    const res = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/activity`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(200);
    const created = res.json().activity.find((a: any) => a.invoice?.id === invoiceId);
    expect(created.action).toBe("INVOICE_CREATED");
    expect(created.actor.name).toBe("Rahul");
  });

  it("a user with no membership in the org gets 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/orgs/00000000-0000-0000-0000-000000000000/activity`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /orgs/:orgId/invoices/:invoiceId/transition", () => {
  it("moves an invoice from Draft to Review", async () => {
    const invoiceId = await createInvoiceAsRahul();
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}/transition`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { toStatus: "REVIEW" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("REVIEW");
  });

  it("rejects an invalid transition (Draft -> Approved) with 400", async () => {
    const invoiceId = await createInvoiceAsRahul();
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}/transition`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { toStatus: "APPROVED" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("blocks Rahul from approving his own invoice via the HTTP endpoint, even as Admin", async () => {
    const invoiceId = await createInvoiceAsRahul();
    await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}/transition`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { toStatus: "REVIEW" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}/transition`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { toStatus: "APPROVED" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows Yash (a different Reviewer) to approve Rahul's invoice", async () => {
    const invoiceId = await createInvoiceAsRahul();
    await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}/transition`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { toStatus: "REVIEW" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}/transition`,
      headers: { authorization: `Bearer ${yashToken}` },
      payload: { toStatus: "APPROVED" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("APPROVED");
  });

  it("returns 400 for an unrecognized target status", async () => {
    const invoiceId = await createInvoiceAsRahul();
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}/transition`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { toStatus: "NOT_A_REAL_STATUS" },
    });
    expect(res.statusCode).toBe(400);
  });

  // Race condition: two eligible reviewers (neither of whom created the
  // invoice) fire Approve and Reject at essentially the same instant. Only
  // one transition may win; the loser must fail cleanly rather than either
  // silently overwriting the winner or leaving the row in a mixed state.
  // Regression test for the fix in migrations/0006_transition_row_lock.sql
  // (transition_invoice() now takes SELECT ... FOR UPDATE on the invoice
  // row before checking the transition whitelist).
  it("Approve and Reject fired concurrently: exactly one wins, the other is rejected, final state is consistent", async () => {
    // Rahul (Admin) creates and submits it. Yash and the test reviewer are
    // both Reviewers who did not create it, so both are eligible to decide
    // it — and Reviewers can't create invoices, so neither can be the maker.
    const invoiceId = await createInvoiceAs(rahulToken);
    const submitRes = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}/transition`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { toStatus: "REVIEW" },
    });
    expect(submitRes.statusCode).toBe(200);

    // Fired together with Promise.all, not awaited one after another, so
    // both requests are genuinely in flight against the database at once.
    const [approveRes, rejectRes] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/orgs/${testOrgId}/invoices/${invoiceId}/transition`,
        headers: { authorization: `Bearer ${yashToken}` },
        payload: { toStatus: "APPROVED" },
      }),
      app.inject({
        method: "POST",
        url: `/orgs/${testOrgId}/invoices/${invoiceId}/transition`,
        headers: { authorization: `Bearer ${testReviewerToken}` },
        payload: { toStatus: "REJECTED" },
      }),
    ]);

    // Exactly one request must succeed and the other must be rejected —
    // never both 200 (double-write), never both non-200 (the valid
    // transition got wrongly blocked).
    const codes = [approveRes.statusCode, rejectRes.statusCode].sort((a, b) => a - b);
    expect(codes).toEqual([200, 400]);

    const winner = approveRes.statusCode === 200 ? approveRes : rejectRes;
    const finalStatus = winner.json().status;
    expect(["APPROVED", "REJECTED"]).toContain(finalStatus);

    // The invoice itself must reflect exactly that one decision — no
    // half-applied mix of both attempts.
    const detail = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(detail.json().status).toBe(finalStatus);

    // Exactly one APPROVED/REJECTED activity entry — the losing attempt
    // must not have logged an entry for a transition that never took effect.
    const decisionEntries = detail
      .json()
      .activity.filter((a: any) => a.action === "INVOICE_APPROVED" || a.action === "INVOICE_REJECTED");
    expect(decisionEntries).toHaveLength(1);
  });
});
