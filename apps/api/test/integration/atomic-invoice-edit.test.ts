// Proves two things about PATCH /orgs/:orgId/invoices/:invoiceId
// (update_invoice() in migrations/0008_atomic_edit_and_optimistic_locking.sql):
//
//  1. Editing is all-or-nothing. If replacing the line items fails part-way,
//     the ORIGINAL invoice — header, totals, line items, version, activity log
//     — is left exactly as it was, instead of half-updated.
//
//  2. Optimistic locking. Two edits based on the same old version cannot both
//     succeed: the second (stale) save is rejected with a conflict and cannot
//     overwrite the first.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../../src/app";
import { createTestOrg, countOrgRows } from "../helpers/test-org";

import { transitionAs } from "../helpers/invoices";
const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

async function loginAs(email: string) {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
  return data.session!.access_token;
}

const app = buildApp({ logger: false });
let rahulToken: string; // Admin @ test org
let yashToken: string; // Reviewer @ test org
let testOrgId: string;
let cleanupTestOrg: () => Promise<void>;

beforeAll(async () => {
  await app.ready();
  rahulToken = await loginAs("rahul@example.com");
  yashToken = await loginAs("yash@example.com");

  const testOrg = await createTestOrg("atomic-edit");
  testOrgId = testOrg.orgId;
  cleanupTestOrg = testOrg.cleanup;
});

afterAll(async () => {
  await cleanupTestOrg();
  await app.close();
});

const uniqueNumber = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const originalItems = [
  { description: "Original A", quantity: 1, rate: 100, taxRate: 10 },
  { description: "Original B", quantity: 2, rate: 50, taxRate: 10 },
];
const goodItem = { description: "Replacement", quantity: 3, rate: 50, taxRate: 10 };
// Fits the invoice's numeric(14,2) totals but not line_items.rate (numeric(12,2)),
// so Postgres rejects it only when that line item row is inserted — after the
// invoice header has been updated and the old line items deleted inside the
// function. If editing were not atomic, that half-finished state would persist.
const overflowingItem = { description: "Too large for its column", quantity: 1, rate: 99_999_999_999, taxRate: 0 };

async function createInvoice(vendor = "Edit Vendor") {
  const res = await app.inject({
    method: "POST",
    url: `/orgs/${testOrgId}/invoices`,
    headers: { authorization: `Bearer ${rahulToken}` },
    payload: { vendor, invoiceNumber: uniqueNumber("EDIT"), invoiceDate: "2026-01-15", lineItems: originalItems },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function getDetail(invoiceId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/orgs/${testOrgId}/invoices/${invoiceId}`,
    headers: { authorization: `Bearer ${rahulToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function patch(invoiceId: string, payload: object, token = rahulToken) {
  return app.inject({
    method: "PATCH",
    url: `/orgs/${testOrgId}/invoices/${invoiceId}`,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
}

// Everything about an invoice that an edit could change, in a comparable form.
function fingerprint(detail: any) {
  return {
    vendor: detail.vendor,
    invoice_number: detail.invoice_number,
    invoice_date: detail.invoice_date,
    taxable_amount: Number(detail.taxable_amount),
    tax_amount: Number(detail.tax_amount),
    total_amount: Number(detail.total_amount),
    version: detail.version,
    status: detail.status,
    lineItems: detail.lineItems
      .map((li: any) => ({
        description: li.description,
        quantity: Number(li.quantity),
        rate: Number(li.rate),
        tax_rate: Number(li.tax_rate),
        amount: Number(li.amount),
      }))
      .sort((a: any, b: any) => a.description.localeCompare(b.description)),
    editedEntries: detail.activity.filter((a: any) => a.action === "INVOICE_EDITED").length,
  };
}

describe("invoice editing is atomic", () => {
  it("rolls back EVERYTHING when replacing the line items fails: the old invoice stays intact", async () => {
    const invoiceId = await createInvoice();
    const before = await getDetail(invoiceId);
    const orgCountsBefore = await countOrgRows(testOrgId);

    const res = await patch(invoiceId, {
      version: before.version,
      // These header changes are applied BEFORE the line items are replaced,
      // so they are exactly what would leak through if the edit weren't atomic.
      vendor: "SHOULD NOT STICK",
      invoiceDate: "2030-12-31",
      lineItems: [goodItem, overflowingItem],
    });
    expect(res.statusCode).toBe(400);

    // The invoice is byte-for-byte what it was: same header, same totals, the
    // ORIGINAL line items still present, same version, no edit logged.
    const after = await getDetail(invoiceId);
    expect(fingerprint(after)).toEqual(fingerprint(before));
    expect(fingerprint(after).lineItems.map((li: any) => li.description)).toEqual(["Original A", "Original B"]);

    // Nothing was written anywhere in the org (checked with the service role,
    // which bypasses RLS, so a policy can't hide a leftover row).
    expect(await countOrgRows(testOrgId)).toEqual(orgCountsBefore);

    // ...and the invoice is still perfectly editable afterwards.
    const retry = await patch(invoiceId, { version: before.version, vendor: "Edited after failed attempt" });
    expect(retry.statusCode).toBe(200);
  });

  it("rolls back the whole edit when it would create a duplicate vendor + invoice number", async () => {
    const firstId = await createInvoice("Dup Vendor");
    const secondId = await createInvoice("Other Vendor");
    const first = await getDetail(firstId);
    const secondBefore = await getDetail(secondId);

    const res = await patch(secondId, {
      version: secondBefore.version,
      vendor: first.vendor,
      invoiceNumber: first.invoice_number,
      lineItems: [goodItem],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_INVOICE");

    expect(fingerprint(await getDetail(secondId))).toEqual(fingerprint(secondBefore));
  });

  it("a successful edit updates header, replaces line items, recomputes totals, bumps version and logs exactly one entry", async () => {
    const invoiceId = await createInvoice();
    const before = await getDetail(invoiceId);
    const orgCountsBefore = await countOrgRows(testOrgId);

    const res = await patch(invoiceId, {
      version: before.version,
      vendor: "Edited Vendor",
      lineItems: [goodItem], // 3 x 50 = 150 taxable, 10% -> 15 tax
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.vendor).toBe("Edited Vendor");
    expect(body.version).toBe(before.version + 1);
    expect(Number(body.total_amount)).toBe(165);
    expect(body.lineItems).toHaveLength(1);

    const after = await getDetail(invoiceId);
    expect(fingerprint(after).lineItems.map((li: any) => li.description)).toEqual(["Replacement"]);
    expect(fingerprint(after).editedEntries).toBe(1);

    const orgCountsAfter = await countOrgRows(testOrgId);
    expect(orgCountsAfter.invoices).toBe(orgCountsBefore.invoices);
    expect(orgCountsAfter.lineItems - orgCountsBefore.lineItems).toBe(1 - 2); // 2 replaced by 1
    expect(orgCountsAfter.activity - orgCountsBefore.activity).toBe(1);
  });
});

describe("optimistic locking", () => {
  const CONFLICT_MESSAGE = "This invoice was changed by another user. Refresh before saving again.";

  it("two edits based on the same old version: the second, stale save cannot overwrite the first", async () => {
    const invoiceId = await createInvoice();
    const loaded = await getDetail(invoiceId); // both "users" open the invoice at this version

    const first = await patch(invoiceId, { version: loaded.version, vendor: "First writer" });
    expect(first.statusCode).toBe(200);

    const second = await patch(invoiceId, { version: loaded.version, vendor: "Second writer (stale)" });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("VERSION_CONFLICT");
    expect(second.json().error).toBe(CONFLICT_MESSAGE);

    // The first writer's change survived; the stale save changed nothing.
    const after = await getDetail(invoiceId);
    expect(after.vendor).toBe("First writer");
    expect(after.version).toBe(loaded.version + 1);
    expect(fingerprint(after).editedEntries).toBe(1); // only the successful edit was logged
  });

  it("the second writer can save after refreshing (re-loading the newer version)", async () => {
    const invoiceId = await createInvoice();
    const loaded = await getDetail(invoiceId);
    await patch(invoiceId, { version: loaded.version, vendor: "First writer" });

    const stale = await patch(invoiceId, { version: loaded.version, vendor: "Second writer" });
    expect(stale.statusCode).toBe(409);

    const refreshed = await getDetail(invoiceId);
    const retry = await patch(invoiceId, { version: refreshed.version, vendor: "Second writer" });
    expect(retry.statusCode).toBe(200);
    expect((await getDetail(invoiceId)).vendor).toBe("Second writer");
  });

  it("edits fired at the same instant with the same version: exactly one wins, the rest conflict", async () => {
    const invoiceId = await createInvoice();
    const loaded = await getDetail(invoiceId);

    const names = ["Writer 1", "Writer 2", "Writer 3", "Writer 4"];
    const results = await Promise.all(names.map((vendor) => patch(invoiceId, { version: loaded.version, vendor })));

    const winners = results.filter((r) => r.statusCode === 200);
    const losers = results.filter((r) => r.statusCode === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(names.length - 1);
    for (const l of losers) expect(l.json().code).toBe("VERSION_CONFLICT");

    // Final state is exactly the winner's edit, and the version moved once.
    const after = await getDetail(invoiceId);
    expect(after.vendor).toBe(winners[0].json().vendor);
    expect(after.version).toBe(loaded.version + 1);
  });

  it("an edit based on a page loaded before a status change is rejected too", async () => {
    const invoiceId = await createInvoice();
    const loaded = await getDetail(invoiceId); // editor opens the Draft

    // Meanwhile the invoice is submitted for review (any update bumps the version).
    const submit = await transitionAs(app, testOrgId, invoiceId, rahulToken, "REVIEW");
    expect(submit.statusCode).toBe(200);

    const stale = await patch(invoiceId, { version: loaded.version, vendor: "Based on the old Draft" });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
  });

  it("requires the version: an edit that doesn't say what it is based on is refused", async () => {
    const invoiceId = await createInvoice();
    const res = await patch(invoiceId, { vendor: "No version supplied" });
    expect(res.statusCode).toBe(400);
    expect((await getDetail(invoiceId)).vendor).toBe("Edit Vendor");
  });

  it("a user who may not edit gets 403, not a conflict, even with a stale version", async () => {
    const invoiceId = await createInvoice();
    const res = await patch(invoiceId, { version: 999, vendor: "Reviewer attempt" }, yashToken);
    expect(res.statusCode).toBe(403);
  });
});
