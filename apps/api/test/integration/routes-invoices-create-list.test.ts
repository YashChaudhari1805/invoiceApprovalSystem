import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { buildApp } from "../../src/app";

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
let abcSteelId: string;
let xyzMetalsId: string;

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
  const orgs = res.json().orgs;
  abcSteelId = orgs.find((o: any) => o.slug === "abc-steel").id;
  xyzMetalsId = orgs.find((o: any) => o.slug === "xyz-metals").id;
});

afterAll(async () => {
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
      url: `/orgs/${abcSteelId}/invoices`,
      payload: validInvoicePayload(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("computes totals server-side, ignoring any amount the client might send", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${abcSteelId}/invoices`,
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
      url: `/orgs/${abcSteelId}/invoices`,
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
      url: `/orgs/${abcSteelId}/invoices`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/orgs/${abcSteelId}/invoices`,
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
      url: `/orgs/${abcSteelId}/invoices?page=1&pageSize=5`,
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
      url: `/orgs/${abcSteelId}/invoices?status=DRAFT`,
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
});
