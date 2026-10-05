// Helpers shared by the integration tests.
//
// Workflow transitions now require the invoice version the actor was looking
// at (migration 0013). These helpers do what the web UI does: read the current
// version, then act on it. Tests that deliberately want a STALE version pass
// one explicitly.

import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getInvoiceVersion(
  app: FastifyInstance,
  orgId: string,
  invoiceId: string,
  token: string
): Promise<number> {
  const res = await app.inject({
    method: "GET",
    url: `/orgs/${orgId}/invoices/${invoiceId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.statusCode !== 200) {
    throw new Error(`getInvoiceVersion: GET invoice returned ${res.statusCode}: ${res.body}`);
  }
  return res.json().version as number;
}

/** POST .../transition through the HTTP API, defaulting to the invoice's current version. */
export async function transitionAs(
  app: FastifyInstance,
  orgId: string,
  invoiceId: string,
  token: string,
  toStatus: string,
  expectedVersion?: number
) {
  const version = expectedVersion ?? (await getInvoiceVersion(app, orgId, invoiceId, token));
  return app.inject({
    method: "POST",
    url: `/orgs/${orgId}/invoices/${invoiceId}/transition`,
    headers: { authorization: `Bearer ${token}` },
    payload: { toStatus, expectedVersion: version },
  });
}

export interface InvoiceInput {
  vendor?: string;
  invoiceNumber: string;
  invoiceDate?: string;
  lineItems?: { description: string; quantity: number; rate: number; taxRate: number }[];
}

/** Create an invoice through the trusted create_invoice() RPC as the given signed-in client. */
export async function createInvoiceRpc(client: SupabaseClient, orgId: string, input: InvoiceInput) {
  return client.rpc("create_invoice", {
    p_organization_id: orgId,
    p_vendor: input.vendor ?? "Test Vendor",
    p_invoice_number: input.invoiceNumber,
    p_invoice_date: input.invoiceDate ?? "2026-01-01",
    p_line_items: input.lineItems ?? [{ description: "Widget", quantity: 1, rate: 1000, taxRate: 18 }],
  });
}

/** transition_invoice() RPC using the invoice's current version (read via the caller's own RLS view). */
export async function transitionRpc(client: SupabaseClient, invoiceId: string, toStatus: string, expectedVersion?: number) {
  let version = expectedVersion;
  if (version === undefined) {
    const { data, error } = await client.from("invoices").select("version").eq("id", invoiceId).single();
    if (error) throw error;
    version = data.version as number;
  }
  return client.rpc("transition_invoice", {
    p_invoice_id: invoiceId,
    p_to_status: toStatus,
    p_expected_version: version,
  });
}
