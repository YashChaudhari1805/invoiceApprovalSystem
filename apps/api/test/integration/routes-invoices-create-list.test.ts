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
let xyzMetalsId: string; // real seeded org — used only for negative tests that never write data
let cleanupTestOrg: () => Promise<void>;

beforeAll(async () => {
  await app.ready();
  const rahul = await loginAs("rahul@example.com");
  const priya = await loginAs("priya@example.com");
  rahulToken = rahul.token;
  priyaToken = priya.token;

  const testOrg = await createTestOrg("invoices-create-list");
  testOrgId = testOrg.orgId;
  cleanupTestOrg = testOrg.cleanup;

  const res = await app.inject({
    method: "GET",
    url: "/orgs",
    headers: { authorization: `Bearer ${rahulToken}` },
  });
  xyzMetalsId = res.json().orgs.find((o: any) => o.slug === "xyz-metals").id;
});

afterAll(async () => {
  await cleanupTestOrg();
  await app.close();
});

function validInvoicePayload(overrides: Partial<any> = {}) {
  return {
    vendor: "Route Test Vendor",
    invoiceNumber: `ROUTE-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    invoiceDate: "2026-01-15",
    lineItems: [{ description: "Widget", quantity: 2, rate: 100, taxRate: 18 }],
    ...overrides,
  };
}

describe("POST /orgs/:orgId/invoices", () => {
  it("rejects a request with no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices`,
      payload: validInvoicePayload(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("computes totals server-side, ignoring any amount the client might send", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: validInvoicePayload(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // quantity 2 * rate 100 = 200 taxable, 18% tax = 36, total 236
    expect(Number(body.taxable_amount)).toBe(200);
    expect(Number(body.tax_amount)).toBe(36);
    expect(Number(body.total_amount)).toBe(236);
  });

  it("rejects invalid input (missing line items) with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: validInvoicePayload({ lineItems: [] }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when Rahul (Viewer at XYZ Metals) tries to create there", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${xyzMetalsId}/invoices`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: validInvoicePayload(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 409 on a duplicate vendor + invoice number within the same org", async () => {
    const payload = validInvoicePayload();
    const first = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/orgs/${testOrgId}/invoices`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload, // identical vendor + invoiceNumber
    });
    expect(second.statusCode).toBe(409);
  });
});

describe("GET /orgs/:orgId/invoices", () => {
  it("returns invoices scoped to the org, paginated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/invoices?page=1&pageSize=5`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(typeof body.total).toBe("number");
  });

  it("filters by status", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/orgs/${testOrgId}/invoices?status=DRAFT`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const item of body.items) {
      expect(item.status).toBe("DRAFT");
    }
  });

  it("Priya (no membership at XYZ Metals) gets 403 listing invoices there", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/orgs/${xyzMetalsId}/invoices`,
      headers: { authorization: `Bearer ${priyaToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  describe("search (?search=)", () => {
    // A unique tag on every run so this suite is never affected by
    // left-over rows from a previous run or from other tests in this file.
    const tag = `SRCH${Date.now()}`;

    beforeAll(async () => {
      const res = await app.inject({
        method: "POST",
        url: `/orgs/${testOrgId}/invoices`,
        headers: { authorization: `Bearer ${rahulToken}` },
        payload: validInvoicePayload({ vendor: "Search Test Vendor", invoiceNumber: `${tag}-0042` }),
      });
      expect(res.statusCode).toBe(201);
    });

    it("matches on a partial, case-insensitive invoice number", async () => {
      const res = await app.inject({
        method: "GET",
        // lowercased and only the middle of the number — proves it's a
        // case-insensitive partial match, not an exact/prefix one.
        url: `/orgs/${testOrgId}/invoices?search=${tag.toLowerCase()}-004`,
        headers: { authorization: `Bearer ${rahulToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.some((item: any) => item.invoice_number === `${tag}-0042`)).toBe(true);
    });

    it("returns no results for a non-matching invoice number", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/orgs/${testOrgId}/invoices?search=THIS-NUMBER-DOES-NOT-EXIST`,
        headers: { authorization: `Bearer ${rahulToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  });

  describe("vendor filter (?vendor=)", () => {
    beforeAll(async () => {
      const res = await app.inject({
        method: "POST",
        url: `/orgs/${testOrgId}/invoices`,
        headers: { authorization: `Bearer ${rahulToken}` },
        payload: validInvoicePayload({ vendor: "Tata Metals", invoiceNumber: `VENDOR-TEST-${Date.now()}` }),
      });
      expect(res.statusCode).toBe(201);
    });

    it("matches a case-insensitive partial vendor name (\"tata\" -> \"Tata Metals\")", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/orgs/${testOrgId}/invoices?vendor=tata`,
        headers: { authorization: `Bearer ${rahulToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item.vendor.toLowerCase()).toContain("tata");
      }
    });

    it("returns no results for a vendor that doesn't exist", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/orgs/${testOrgId}/invoices?vendor=NoSuchVendorAtAll`,
        headers: { authorization: `Bearer ${rahulToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(0);
    });
  });

  describe("GET /orgs/:orgId/invoices/summary", () => {
    it("counts drafts and in-review invoices for this org", async () => {
      // Fresh org, seeded with exactly one of each so the counts are exact,
      // not just "greater than zero" against a shared/reused org.
      const summaryOrg = await createTestOrg("invoices-summary");
      try {
        await app.inject({
          method: "POST",
          url: `/orgs/${summaryOrg.orgId}/invoices`,
          headers: { authorization: `Bearer ${rahulToken}` },
          payload: validInvoicePayload({ invoiceNumber: `SUMMARY-DRAFT-${Date.now()}` }),
        });
        const reviewInvoice = await app.inject({
          method: "POST",
          url: `/orgs/${summaryOrg.orgId}/invoices`,
          headers: { authorization: `Bearer ${rahulToken}` },
          payload: validInvoicePayload({ invoiceNumber: `SUMMARY-REVIEW-${Date.now()}` }),
        });
        await app.inject({
          method: "POST",
          url: `/orgs/${summaryOrg.orgId}/invoices/${reviewInvoice.json().id}/transition`,
          headers: { authorization: `Bearer ${rahulToken}` },
          payload: { toStatus: "REVIEW" },
        });

        const res = await app.inject({
          method: "GET",
          url: `/orgs/${summaryOrg.orgId}/invoices/summary`,
          headers: { authorization: `Bearer ${rahulToken}` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.draft).toBe(1);
        expect(body.review).toBe(1);
        expect(body.processedRecently).toBe(0);
      } finally {
        await summaryOrg.cleanup();
      }
    });

    it("returns 403 for a user with no membership in the org", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/orgs/${xyzMetalsId}/invoices/summary`,
        headers: { authorization: `Bearer ${priyaToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
