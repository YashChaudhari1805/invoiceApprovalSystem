// Proves the database itself — not just the API — enforces two things
// (migrations/0009_lockdown_and_audit.sql):
//
//  1. (6.1-6.3) A normal, authenticated org member cannot fabricate activity
//     history, set an invoice's totals directly, or write line items
//     directly, even by talking to Supabase straight from a browser
//     console — bypassing the API entirely.
//
//  2. (7) The audit entry is part of the same transaction as the business
//     action it records: if the audit insert fails, the action it would
//     have recorded is rolled back too, so the final state and the history
//     can never disagree.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createTestOrg, countOrgRows, createInvoiceWithBrokenAudit } from "../helpers/test-org";

import { transitionRpc } from "../helpers/invoices";
const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

async function loginAs(email: string): Promise<SupabaseClient> {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
  return client;
}

let rahul: SupabaseClient; // Admin @ test org
let rahulId: string;
let testOrgId: string;
let cleanupTestOrg: () => Promise<void>;

beforeAll(async () => {
  rahul = await loginAs("rahul@example.com");
  rahulId = (await rahul.auth.getUser()).data.user!.id;

  const testOrg = await createTestOrg("lockdown-and-audit");
  testOrgId = testOrg.orgId;
  cleanupTestOrg = testOrg.cleanup;
});

afterAll(async () => {
  await cleanupTestOrg();
});

const uniqueNumber = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function createInvoice(vendor = "Lockdown Vendor") {
  const { data, error } = await rahul.rpc("create_invoice", {
    p_organization_id: testOrgId,
    p_vendor: vendor,
    p_invoice_number: uniqueNumber("LK"),
    p_invoice_date: "2026-01-15",
    p_line_items: [{ description: "Widget", quantity: 1, rate: 100, taxRate: 18 }],
  });
  if (error) throw error;
  return data;
}

describe("6.1 activity history cannot be fabricated directly", () => {
  it("a normal org member's direct INSERT into activity_log is rejected", async () => {
    const invoice = await createInvoice();
    const before = await countOrgRows(testOrgId);

    const { error } = await rahul.from("activity_log").insert({
      organization_id: testOrgId,
      invoice_id: invoice.id,
      actor_id: rahulId,
      action: "INVOICE_APPROVED", // a fabricated approval that never actually happened
      metadata: { from: "REVIEW", to: "APPROVED" },
    });

    expect(error).not.toBeNull();
    // Table/column privilege denials surface as 42501, distinct from an RLS
    // policy denial (which reports success with zero rows affected) —
    // either way, nothing gets written.
    expect(error!.code).toBe("42501");

    const after = await countOrgRows(testOrgId);
    expect(after.activity).toBe(before.activity);
  });
});

describe("6.2 invoice totals cannot be set directly", () => {
  it("a direct UPDATE of total_amount (or taxable_amount/tax_amount) is rejected", async () => {
    const invoice = await createInvoice();

    const { error } = await rahul
      .from("invoices")
      .update({ total_amount: 999999.99, taxable_amount: 999999.99, tax_amount: 0 })
      .eq("id", invoice.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");

    const { data: after } = await rahul.from("invoices").select("total_amount").eq("id", invoice.id).single();
    expect(Number(after!.total_amount)).toBe(Number(invoice.total_amount));
  });

  it("the same is true for every other invoice header column (vendor, dates, ...) — the whole row is update_invoice()-only now", async () => {
    const invoice = await createInvoice();
    const { error } = await rahul.from("invoices").update({ vendor: "Direct Write Vendor" }).eq("id", invoice.id);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });
});

describe("6.3 line items cannot be written directly", () => {
  it("direct INSERT, UPDATE and DELETE on line_items are all rejected", async () => {
    const invoice = await createInvoice();
    const { data: items } = await rahul.from("line_items").select("id").eq("invoice_id", invoice.id);
    const lineItemId = items![0].id;

    const insertRes = await rahul
      .from("line_items")
      .insert({ invoice_id: invoice.id, description: "Fabricated", quantity: 1, rate: 1, tax_rate: 0, amount: 1 });
    expect(insertRes.error?.code).toBe("42501");

    const updateRes = await rahul.from("line_items").update({ amount: 1 }).eq("id", lineItemId);
    expect(updateRes.error?.code).toBe("42501");

    const deleteRes = await rahul.from("line_items").delete().eq("id", lineItemId);
    expect(deleteRes.error?.code).toBe("42501");

    // Nothing about the invoice's real line items changed.
    const { data: after } = await rahul.from("line_items").select("id, amount").eq("invoice_id", invoice.id);
    expect(after).toHaveLength(1);
    expect(after![0].id).toBe(lineItemId);
  });
});

describe("7 audit history is part of the transaction, not best-effort", () => {
  it("if the activity_log insert fails, the invoice it would have recorded is rolled back too", async () => {
    const before = await countOrgRows(testOrgId);
    const vendor = "Audit Failure Vendor";
    const invoiceNumber = uniqueNumber("AUDITFAIL");

    const { data, error } = await createInvoiceWithBrokenAudit(rahulId, testOrgId, vendor, invoiceNumber, "2026-01-15", [
      { description: "Widget", quantity: 1, rate: 100, taxRate: 18 },
    ]);

    // The call fails outright — it does NOT silently succeed without history.
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/simulated activity_log failure/);

    // And nothing was left behind: no invoice, no line items, no activity —
    // exactly what "audit entry in the same transaction as the business
    // action" means.
    const after = await countOrgRows(testOrgId);
    expect(after).toEqual(before);

    const { count } = await rahul
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", testOrgId)
      .eq("invoice_number", invoiceNumber);
    expect(count).toBe(0);
  });

  it("...and a normal call right after is completely unaffected (the failure was scoped to that one call only)", async () => {
    const before = await countOrgRows(testOrgId);
    const invoice = await createInvoice("Post-Break Vendor");
    expect(invoice.id).toBeTruthy();
    const after = await countOrgRows(testOrgId);
    expect(after.invoices - before.invoices).toBe(1);
  });
});

describe("richer audit metadata (section 7)", () => {
  it("a status transition records both the old and new status", async () => {
    const invoice = await createInvoice();
    await transitionRpc(rahul, invoice.id, "REVIEW");

    const { data: entries } = await rahul
      .from("activity_log")
      .select("action, metadata")
      .eq("invoice_id", invoice.id)
      .eq("action", "INVOICE_SUBMITTED");
    expect(entries).toHaveLength(1);
    // `version` (added in 0013) records which version the actor acted on.
    expect(entries![0].metadata).toMatchObject({ from: "DRAFT", to: "REVIEW" });
    expect(typeof entries![0].metadata.version).toBe("number");
  });

  it("an edit records which fields were changed", async () => {
    const invoice = await createInvoice();
    await rahul.rpc("update_invoice", {
      p_organization_id: testOrgId,
      p_invoice_id: invoice.id,
      p_expected_version: invoice.version,
      p_patch: { vendor: "Edited Vendor", invoiceDate: "2026-02-01" },
    });

    const { data: entries } = await rahul
      .from("activity_log")
      .select("metadata")
      .eq("invoice_id", invoice.id)
      .eq("action", "INVOICE_EDITED");
    expect(entries).toHaveLength(1);
    expect(entries![0].metadata.changedFields.sort()).toEqual(["invoiceDate", "vendor"]);
  });
});
