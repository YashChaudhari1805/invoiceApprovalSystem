// Proves section 10's idempotency requirement, through the real HTTP route
// (migrations/0012_idempotency.sql, apps/api/src/routes/invoices.ts):
// sending the same POST /orgs/:orgId/invoices request twice with the same
// Idempotency-Key header returns the ORIGINAL response, and only one
// invoice is ever created — as opposed to the (organization_id, vendor,
// invoice_number) unique constraint, which would instead reject the retry
// with a 409 "already exists" error. See the comment at the top of
// 0012_idempotency.sql for the full explanation of how the two differ.

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
  return data.session!.access_token;
}

const app = buildApp({ logger: false });
let rahulToken: string;
let testOrgId: string;
let cleanupTestOrg: () => Promise<void>;

beforeAll(async () => {
  await app.ready();
  rahulToken = await loginAs("rahul@example.com");
  const testOrg = await createTestOrg("idempotency");
  testOrgId = testOrg.orgId;
  cleanupTestOrg = testOrg.cleanup;
});

afterAll(async () => {
  await cleanupTestOrg();
  await app.close();
});

const uniqueNumber = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function createInvoice(payload: object, idempotencyKey?: string) {
  return app.inject({
    method: "POST",
    url: `/orgs/${testOrgId}/invoices`,
    headers: {
      authorization: `Bearer ${rahulToken}`,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    payload,
  });
}

const basePayload = (invoiceNumber: string) => ({
  vendor: "Idempotency Vendor",
  invoiceNumber,
  invoiceDate: "2026-01-15",
  lineItems: [{ description: "Widget", quantity: 1, rate: 100, taxRate: 18 }],
});

describe("idempotent invoice creation", () => {
  it("sending the same request twice with the same Idempotency-Key returns the ORIGINAL response, not a duplicate or an error", async () => {
    const key = `test-key-${uniqueNumber("k")}`;
    const payload = basePayload(uniqueNumber("IDEM"));
    const before = await countOrgRows(testOrgId);

    const first = await createInvoice(payload, key);
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();

    const second = await createInvoice(payload, key);
    // Not a 409 (that's what the unique constraint alone would give a
    // retry) — the exact same success response as the first call.
    expect(second.statusCode).toBe(201);
    const secondBody = second.json();
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.created_at).toBe(firstBody.created_at);
    expect(secondBody.lineItems).toEqual(firstBody.lineItems);

    const after = await countOrgRows(testOrgId);
    expect(after.invoices - before.invoices).toBe(1); // only ONE invoice, not two
    expect(after.activity - before.activity).toBe(1); // only ONE activity entry
  });

  it("the same key sent with a DIFFERENT payload is rejected, not silently treated as a retry", async () => {
    const key = `test-key-${uniqueNumber("k")}`;
    const first = await createInvoice(basePayload(uniqueNumber("IDEM-A")), key);
    expect(first.statusCode).toBe(201);

    const second = await createInvoice(basePayload(uniqueNumber("IDEM-B")), key); // different invoice number
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toMatch(/already used for a different request/);
  });

  it("a different key with the same payload creates a genuinely new invoice (not deduplicated by content)", async () => {
    const invoiceNumber = uniqueNumber("IDEM-SAMECONTENT");
    const first = await createInvoice(basePayload(invoiceNumber), `key-1-${uniqueNumber("k")}`);
    expect(first.statusCode).toBe(201);

    // Same body, different key, same invoice number -> this is a genuinely
    // new request that happens to collide on business data, so the ORDINARY
    // unique constraint (not idempotency) is what should stop it.
    const second = await createInvoice(basePayload(invoiceNumber), `key-2-${uniqueNumber("k")}`);
    expect(second.statusCode).toBe(409);
  });

  it("requests with no Idempotency-Key header behave exactly as before (fully optional)", async () => {
    const res = await createInvoice(basePayload(uniqueNumber("NOKEY")));
    expect(res.statusCode).toBe(201);
  });

  it("10 concurrent retries with the same key and payload: all succeed, only one invoice is created", async () => {
    const key = `test-key-${uniqueNumber("k")}`;
    const payload = basePayload(uniqueNumber("IDEM-RACE"));
    const before = await countOrgRows(testOrgId);

    const results = await Promise.all(Array.from({ length: 10 }, () => createInvoice(payload, key)));

    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const ids = new Set(results.map((r) => r.json().id));
    expect(ids.size).toBe(1); // every response names the same invoice

    const after = await countOrgRows(testOrgId);
    expect(after.invoices - before.invoices).toBe(1); // and only one was actually created
  });
});
