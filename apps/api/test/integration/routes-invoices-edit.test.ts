import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../../src/app";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

async function loginAs(email: string) {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
  return { token: data.session!.access_token, client };
}

const app = buildApp({ logger: false });
let rahulToken: string; // Admin @ ABC Steel
let priyaToken: string; // Reviewer @ ABC Steel — cannot edit at all
let abcSteelId: string;

beforeAll(async () => {
  await app.ready();
  const rahul = await loginAs("rahul@example.com");
  const priya = await loginAs("priya@example.com");
  rahulToken = rahul.token;
  priyaToken = priya.token;

  const res = await app.inject({
    method: "GET",
    url: "/orgs",
    headers: { authorization: `Bearer ${rahulToken}` },
  });
  abcSteelId = res.json().orgs.find((o: any) => o.slug === "abc-steel").id;
});

afterAll(async () => {
  await app.close();
});

async function createInvoiceAsRahul() {
  const res = await app.inject({
    method: "POST",
    url: `/orgs/${abcSteelId}/invoices`,
    headers: { authorization: `Bearer ${rahulToken}` },
    payload: {
      vendor: "Edit Test Vendor",
      invoiceNumber: `EDIT-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      invoiceDate: "2026-01-15",
      lineItems: [{ description: "Widget", quantity: 1, rate: 100, taxRate: 10 }],
    },
  });
  return res.json().id as string;
}

async function transition(invoiceId: string, toStatus: string, token: string) {
  return app.inject({
    method: "POST",
    url: `/orgs/${abcSteelId}/invoices/${invoiceId}/transition`,
    headers: { authorization: `Bearer ${token}` },
    payload: { toStatus },
  });
}

describe("PATCH /orgs/:orgId/invoices/:invoiceId", () => {
  it("Admin can update vendor and recompute totals from new line items", async () => {
    const invoiceId = await createInvoiceAsRahul();
    const res = await app.inject({
      method: "PATCH",
      url: `/orgs/${abcSteelId}/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: {
        vendor: "Updated Vendor Name",
        lineItems: [{ description: "New Widget", quantity: 3, rate: 50, taxRate: 10 }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.vendor).toBe("Updated Vendor Name");
    expect(Number(body.total_amount)).toBe(165); // 150 taxable + 15 tax
  });

  it("Reviewer cannot edit an invoice at all", async () => {
    const invoiceId = await createInvoiceAsRahul();
    const res = await app.inject({
      method: "PATCH",
      url: `/orgs/${abcSteelId}/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${priyaToken}` },
      payload: { vendor: "Should Not Work" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Admin can still edit an Approved invoice (per spec, Admin is unrestricted)", async () => {
    const invoiceId = await createInvoiceAsRahul();
    await transition(invoiceId, "REVIEW", rahulToken);
    await transition(invoiceId, "APPROVED", priyaToken); // Priya approves since Rahul created it

    const res = await app.inject({
      method: "PATCH",
      url: `/orgs/${abcSteelId}/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { vendor: "Post-Approval Admin Edit" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 409 if the edit would create a duplicate vendor + invoice number", async () => {
    const firstId = await createInvoiceAsRahul();
    const secondId = await createInvoiceAsRahul();

    const firstDetail = await app.inject({
      method: "GET",
      url: `/orgs/${abcSteelId}/invoices/${firstId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    const { vendor, invoice_number } = firstDetail.json();

    const res = await app.inject({
      method: "PATCH",
      url: `/orgs/${abcSteelId}/invoices/${secondId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { vendor, invoiceNumber: invoice_number },
    });
    expect(res.statusCode).toBe(409);
  });

  it("cannot change status through the edit payload (schema doesn't accept it, DB doesn't grant it)", async () => {
    const invoiceId = await createInvoiceAsRahul();
    const res = await app.inject({
      method: "PATCH",
      url: `/orgs/${abcSteelId}/invoices/${invoiceId}`,
      payload: { vendor: "Still Editable", status: "APPROVED" },
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(200); // the vendor update succeeds
    const detail = await app.inject({
      method: "GET",
      url: `/orgs/${abcSteelId}/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(detail.json().status).toBe("DRAFT"); // status was silently ignored, not changed
  });
});
