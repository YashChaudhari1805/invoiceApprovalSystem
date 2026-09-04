import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../../src/app";
import { createTestOrg } from "../helpers/test-org";

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
let priyaToken: string;
let testOrgId: string;
let cleanupTestOrg: () => Promise<void>;

beforeAll(async () => {
  await app.ready();
  const rahul = await loginAs("rahul@example.com");
  const priya = await loginAs("priya@example.com");
  rahulToken = rahul.token;
  priyaToken = priya.token;

  const testOrg = await createTestOrg("invoices-detail-transition");
  testOrgId = testOrg.orgId;
  cleanupTestOrg = testOrg.cleanup;
});

afterAll(async () => {
  await cleanupTestOrg();
  await app.close();
});

async function createInvoiceAsRahul() {
  const res = await app.inject({
    method: "POST",
    url: `/orgs/${testOrgId}/invoices`,
    headers: { authorization: `Bearer ${rahulToken}` },
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

  it("allows Priya (a different Reviewer) to approve Rahul's invoice", async () => {
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
      headers: { authorization: `Bearer ${priyaToken}` },
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
});
