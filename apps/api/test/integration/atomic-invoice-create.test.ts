// Proves invoice creation is all-or-nothing (create_invoice() in
// migrations/0007_atomic_create_invoice.sql).
//
// Before that migration, the API inserted the invoice, then its line items,
// then the activity entry as three separate writes. A failure part-way
// through left an invoice behind with missing line items, and the API's
// "cleanup" delete was best-effort and could itself fail.
//
// The key test below deliberately makes the SECOND line item fail at the
// database (its rate is too large for the line_items.rate column) — after the
// invoice row and the first line item have already been written inside the
// function. If creation were not atomic, those would still be there.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../../src/app";
import { createTestOrg, countOrgRows } from "../helpers/test-org";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

async function loginAs(email: string) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
  const { data } = await client.auth.getSession();
  return { client, token: data.session!.access_token };
}

const app = buildApp({ logger: false });
let rahulToken: string;
let yashClient: Awaited<ReturnType<typeof loginAs>>["client"]; // Reviewer @ test org
let nehaClient: Awaited<ReturnType<typeof loginAs>>["client"]; // not a member of the test org
let testOrgId: string;
let cleanupTestOrg: () => Promise<void>;

beforeAll(async () => {
  await app.ready();
  rahulToken = (await loginAs("rahul@example.com")).token;
  yashClient = (await loginAs("yash@example.com")).client;
  nehaClient = (await loginAs("neha@example.com")).client;

  const testOrg = await createTestOrg("atomic-create");
  testOrgId = testOrg.orgId;
  cleanupTestOrg = testOrg.cleanup;
});

afterAll(async () => {
  await cleanupTestOrg();
  await app.close();
});

const uniqueNumber = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function createInvoice(payload: object) {
  return app.inject({
    method: "POST",
    url: `/orgs/${testOrgId}/invoices`,
    headers: { authorization: `Bearer ${rahulToken}` },
    payload,
  });
}

const goodItem = { description: "Widget", quantity: 1, rate: 100, taxRate: 18 };
// 99,999,999,999 fits the invoice's numeric(14,2) totals but NOT line_items.rate
// (numeric(12,2), max ~10 billion) — so Postgres rejects it only when the line
// item row is inserted, i.e. after the invoice row has already been written.
const overflowingItem = { description: "Too large for its column", quantity: 1, rate: 99_999_999_999, taxRate: 0 };

describe("invoice creation is atomic", () => {
  it("rolls back the invoice, its line items and the activity entry when a later line item fails", async () => {
    const before = await countOrgRows(testOrgId);
    const invoiceNumber = uniqueNumber("ATOMIC-FAIL");

    const res = await createInvoice({
      vendor: "Atomic Vendor",
      invoiceNumber,
      invoiceDate: "2026-01-15",
      lineItems: [goodItem, overflowingItem],
    });

    // The request fails cleanly (a client error, not a crash)...
    expect(res.statusCode).toBe(400);

    // ...and NOTHING was persisted: not the invoice, not the first (valid)
    // line item that was inserted before the failure, not an activity entry.
    const after = await countOrgRows(testOrgId);
    expect(after).toEqual(before);

    // Also not visible through the API.
    const list = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/invoices?search=${invoiceNumber}`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(list.json().items).toHaveLength(0);
  });

  it("leaves no orphan behind: the same invoice number can be created properly right after a failed attempt", async () => {
    const invoiceNumber = uniqueNumber("ATOMIC-RETRY");
    const base = { vendor: "Atomic Vendor", invoiceNumber, invoiceDate: "2026-01-15" };

    const failed = await createInvoice({ ...base, lineItems: [goodItem, overflowingItem] });
    expect(failed.statusCode).toBe(400);

    // If the failed attempt had left a half-created invoice behind, this
    // would be a 409 duplicate.
    const retry = await createInvoice({ ...base, lineItems: [goodItem] });
    expect(retry.statusCode).toBe(201);
  });

  it("a successful create writes exactly one invoice, all its line items, and one INVOICE_CREATED entry", async () => {
    const before = await countOrgRows(testOrgId);

    const res = await createInvoice({
      vendor: "Atomic Vendor",
      invoiceNumber: uniqueNumber("ATOMIC-OK"),
      invoiceDate: "2026-01-15",
      lineItems: [goodItem, { ...goodItem, description: "Gadget" }, { ...goodItem, description: "Gizmo" }],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().lineItems).toHaveLength(3);

    const after = await countOrgRows(testOrgId);
    expect(after.invoices - before.invoices).toBe(1);
    expect(after.lineItems - before.lineItems).toBe(3);
    expect(after.activity - before.activity).toBe(1);

    const detail = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/invoices/${res.json().id}`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    const actions = detail.json().activity.map((a: any) => a.action);
    expect(actions).toEqual(["INVOICE_CREATED"]);
  });

  it("a duplicate vendor + invoice number returns 409 and leaves nothing extra behind", async () => {
    const payload = {
      vendor: "Atomic Vendor",
      invoiceNumber: uniqueNumber("ATOMIC-DUP"),
      invoiceDate: "2026-01-15",
      lineItems: [goodItem],
    };
    expect((await createInvoice(payload)).statusCode).toBe(201);
    const before = await countOrgRows(testOrgId);

    expect((await createInvoice(payload)).statusCode).toBe(409);
    expect(await countOrgRows(testOrgId)).toEqual(before);
  });
});

describe("create_invoice() enforces access and totals itself, not just the API around it", () => {
  const rpcArgs = () => ({
    p_organization_id: testOrgId,
    p_vendor: "Direct Call Vendor",
    p_invoice_number: uniqueNumber("DIRECT"),
    p_invoice_date: "2026-01-15",
    p_line_items: [goodItem],
  });

  it("refuses a Reviewer calling the database function directly (bypassing the API)", async () => {
    const before = await countOrgRows(testOrgId);
    const { data, error } = await yashClient.rpc("create_invoice", rpcArgs());
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await countOrgRows(testOrgId)).toEqual(before);
  });

  it("refuses a user who is not a member of the organization", async () => {
    const before = await countOrgRows(testOrgId);
    const { data, error } = await nehaClient.rpc("create_invoice", rpcArgs());
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await countOrgRows(testOrgId)).toEqual(before);
  });

  it("computes exact decimal totals in the database, rounding half-up per line", async () => {
    // 3 x 33.33 = 99.99 taxable, 18% -> 18.00 (17.9982)
    // 0.5 x 19.99 = 9.995 -> 10.00 (half-up) taxable, 12% -> 1.20
    const res = await createInvoice({
      vendor: "Decimal Vendor",
      invoiceNumber: uniqueNumber("DEC-1"),
      invoiceDate: "2026-01-15",
      lineItems: [
        { description: "A", quantity: 3, rate: 33.33, taxRate: 18 },
        { description: "B", quantity: 0.5, rate: 19.99, taxRate: 12 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Number(body.taxable_amount)).toBe(109.99);
    expect(Number(body.tax_amount)).toBe(19.2);
    expect(Number(body.total_amount)).toBe(129.19);
  });

  it("gets a case right that floating-point arithmetic gets wrong by one paisa", async () => {
    // 259.78 x 3933.75 is exactly 1,021,909.575 -> rounds half-up to .58.
    // As a JavaScript float the product is 1021909.5749999..., which rounds
    // down to .57. Exact decimal arithmetic in Postgres avoids that.
    const res = await createInvoice({
      vendor: "Decimal Vendor",
      invoiceNumber: uniqueNumber("DEC-2"),
      invoiceDate: "2026-01-15",
      lineItems: [{ description: "Edge case", quantity: 259.78, rate: 3933.75, taxRate: 41.72 }],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Number(body.taxable_amount)).toBe(1021909.58);
    expect(Number(body.tax_amount)).toBe(426340.68);
    expect(Number(body.total_amount)).toBe(1448250.26);
  });
});
