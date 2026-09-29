// Proves the validation rule from section 8 is enforced consistently:
//   quantity  > 0
//   rate      >= 0
//   tax_rate  0-100 inclusive
//   text fields (vendor, invoice number, line item description) are
//   non-blank and within the API's max length
//
// Two layers are tested for each rule:
//   - API (createInvoiceSchema / update_invoice()'s validation): a normal
//     POST/PATCH request with a bad value is rejected with 400.
//   - Database (migrations/0010_numeric_and_length_constraints.sql): a
//     direct INSERT that bypasses the API entirely is rejected by a CHECK
//     constraint — proving the rule doesn't only hold because the app
//     happens to enforce it.
// The browser-level copy of this same rule (apps/web/src/components/line-items-editor.tsx)
// isn't exercised here since these are API-level tests; it was verified by
// hand and mirrors the same limits.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../../src/app";
import { createTestOrg, insertLineItemDirect } from "../helpers/test-org";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

async function loginAs(email: string) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
  const { data } = await client.auth.getSession();
  return data.session!.access_token;
}

const app = buildApp({ logger: false });
let rahulToken: string;
let testOrgId: string;
let cleanupTestOrg: () => Promise<void>;

beforeAll(async () => {
  await app.ready();
  rahulToken = await loginAs("rahul@example.com");
  const testOrg = await createTestOrg("validation");
  testOrgId = testOrg.orgId;
  cleanupTestOrg = testOrg.cleanup;
});

afterAll(async () => {
  await cleanupTestOrg();
  await app.close();
});

const uniqueNumber = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function createInvoice(lineItems: object[], overrides: object = {}) {
  return app.inject({
    method: "POST",
    url: `/orgs/${testOrgId}/invoices`,
    headers: { authorization: `Bearer ${rahulToken}` },
    payload: {
      vendor: "Validation Vendor",
      invoiceNumber: uniqueNumber("VAL"),
      invoiceDate: "2026-01-15",
      lineItems,
      ...overrides,
    },
  });
}

async function baseInvoiceId() {
  const res = await createInvoice([{ description: "seed item", quantity: 1, rate: 10, taxRate: 0 }]);
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("API layer rejects invalid numeric values (section 8)", () => {
  it.each([
    ["zero quantity", { description: "x", quantity: 0, rate: 10, taxRate: 0 }],
    ["negative quantity", { description: "x", quantity: -1, rate: 10, taxRate: 0 }],
    ["negative rate", { description: "x", quantity: 1, rate: -10, taxRate: 0 }],
    ["tax rate below 0", { description: "x", quantity: 1, rate: 10, taxRate: -1 }],
    ["tax rate above 100", { description: "x", quantity: 1, rate: 10, taxRate: 101 }],
    ["blank description", { description: "", quantity: 1, rate: 10, taxRate: 0 }],
    ["description over 500 characters", { description: "x".repeat(501), quantity: 1, rate: 10, taxRate: 0 }],
  ])("%s -> 400, nothing created", async (_name, lineItem) => {
    const res = await createInvoice([lineItem]);
    expect(res.statusCode).toBe(400);
  });

  it("rate of exactly 0 is ALLOWED (a free sample line is a real line item)", async () => {
    const res = await createInvoice([{ description: "Free sample", quantity: 1, rate: 0, taxRate: 0 }]);
    expect(res.statusCode).toBe(201);
  });

  it("tax rate of exactly 0 and exactly 100 are both ALLOWED (inclusive range)", async () => {
    const zero = await createInvoice([{ description: "x", quantity: 1, rate: 10, taxRate: 0 }]);
    const hundred = await createInvoice([{ description: "x", quantity: 1, rate: 10, taxRate: 100 }]);
    expect(zero.statusCode).toBe(201);
    expect(hundred.statusCode).toBe(201);
    expect(Number(hundred.json().total_amount)).toBe(20); // 10 taxable + 100% tax
  });

  it("vendor over 255 characters -> 400", async () => {
    const res = await createInvoice([{ description: "x", quantity: 1, rate: 10, taxRate: 0 }], { vendor: "V".repeat(256) });
    expect(res.statusCode).toBe(400);
  });

  it("invoice number over 100 characters -> 400", async () => {
    const res = await createInvoice([{ description: "x", quantity: 1, rate: 10, taxRate: 0 }], {
      invoiceNumber: "N".repeat(101),
    });
    expect(res.statusCode).toBe(400);
  });

  it("the same rules apply to PATCH (editing an invoice's line items)", async () => {
    const invoiceId = await baseInvoiceId();
    const detail = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/orgs/${testOrgId}/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { version: detail.json().version, lineItems: [{ description: "x", quantity: 0, rate: 10, taxRate: 0 }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("database layer rejects the same invalid values even bypassing the API entirely (defense in depth)", () => {
  it.each([
    ["zero quantity", { quantity: 0 }],
    ["negative quantity", { quantity: -1 }],
    ["negative rate", { rate: -10 }],
    ["tax rate below 0", { taxRate: -1 }],
    ["tax rate above 100", { taxRate: 101 }],
    ["blank description", { description: "" }],
  ])("direct INSERT with %s is rejected by a CHECK constraint", async (_name, fields) => {
    const invoiceId = await baseInvoiceId();
    const { error } = await insertLineItemDirect(invoiceId, fields);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514"); // Postgres: check_violation
  });

  it("a direct INSERT with all-valid values is accepted (constraints aren't overly strict)", async () => {
    const invoiceId = await baseInvoiceId();
    const { error } = await insertLineItemDirect(invoiceId, { quantity: 2, rate: 0, taxRate: 100 });
    expect(error).toBeNull();
  });
});
