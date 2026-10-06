import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeLikePattern } from "../../shared/search";
import type { InvoiceStatus } from "./rules";
import type { z } from "zod";
import type { createInvoiceSchema, listQuerySchema, updateInvoiceSchema } from "./schemas";

// All database access for invoices lives here. Every call goes through the
// caller's own Supabase client, so Row Level Security applies to all of it.
// Business rules live in Postgres functions (create_invoice, update_invoice,
// transition_invoice); this file only calls them.

type CreateInput = z.infer<typeof createInvoiceSchema>;
type UpdateInput = z.infer<typeof updateInvoiceSchema>;
type ListQuery = z.infer<typeof listQuerySchema>;

const LIST_COLUMNS = "id, vendor, invoice_number, invoice_date, status, total_amount, created_at, created_by";

/** One transaction: role check, totals, invoice, line items and audit entry. */
export function createInvoice(
  db: SupabaseClient,
  orgId: string,
  input: CreateInput,
  idempotencyKey: string | null
) {
  return db.rpc("create_invoice", {
    p_organization_id: orgId,
    p_vendor: input.vendor,
    p_invoice_number: input.invoiceNumber,
    p_invoice_date: input.invoiceDate,
    p_line_items: input.lineItems,
    p_idempotency_key: idempotencyKey,
  });
}

/** Filtering, search and pagination all happen in this single query. */
export function listInvoices(db: SupabaseClient, orgId: string, q: ListQuery) {
  let query = db
    .from("invoices")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  // Case-insensitive partial match; user-typed % and _ are escaped so they stay literal.
  if (q.search) query = query.ilike("invoice_number", `%${escapeLikePattern(q.search)}%`);
  if (q.vendor) query = query.ilike("vendor", `%${escapeLikePattern(q.vendor)}%`);
  if (q.status) query = query.eq("status", q.status);

  const from = (q.page - 1) * q.pageSize;
  return query.range(from, from + q.pageSize - 1);
}

/** Count-only queries for the triage widgets; always whole-org, ignoring list filters. */
export async function getSummary(db: SupabaseClient, orgId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const countBy = (status: InvoiceStatus) =>
    db.from("invoices").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", status);

  const [draft, review, processedRecently] = await Promise.all([
    countBy("DRAFT"),
    countBy("REVIEW"),
    db
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .in("status", ["APPROVED", "REJECTED"])
      .gte("updated_at", sevenDaysAgo),
  ]);

  return {
    error: draft.error ?? review.error ?? processedRecently.error,
    counts: { draft: draft.count ?? 0, review: review.count ?? 0, processedRecently: processedRecently.count ?? 0 },
  };
}

export function findInvoice(db: SupabaseClient, orgId: string, invoiceId: string) {
  return db
    .from("invoices")
    .select(
      "*, creator:profiles!invoices_created_by_fkey(id, name, email), approver:profiles!invoices_approved_by_fkey(id, name, email)"
    )
    .eq("id", invoiceId)
    .eq("organization_id", orgId)
    .maybeSingle();
}

export function findLineItems(db: SupabaseClient, invoiceId: string) {
  return db.from("line_items").select("*").eq("invoice_id", invoiceId);
}

export function findInvoiceActivity(db: SupabaseClient, invoiceId: string) {
  return db
    .from("activity_log")
    .select("id, action, metadata, created_at, actor:profiles(id, name)")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });
}

/** Only fields the client sent are included, so status can never ride along in a patch. */
export function updateInvoice(db: SupabaseClient, orgId: string, invoiceId: string, input: UpdateInput) {
  const { version, vendor, invoiceNumber, invoiceDate, lineItems } = input;
  return db.rpc("update_invoice", {
    p_organization_id: orgId,
    p_invoice_id: invoiceId,
    p_expected_version: version,
    p_patch: { vendor, invoiceNumber, invoiceDate, lineItems },
  });
}

export function transitionInvoice(db: SupabaseClient, invoiceId: string, toStatus: string, expectedVersion: number) {
  return db.rpc("transition_invoice", {
    p_invoice_id: invoiceId,
    p_to_status: toStatus,
    p_expected_version: expectedVersion,
  });
}
