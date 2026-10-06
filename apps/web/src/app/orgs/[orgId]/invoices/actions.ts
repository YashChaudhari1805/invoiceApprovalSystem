"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { apiFetch, ApiError, ApiOutcomeUnknownError } from "@/lib/api";

interface LineItemInput {
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
}

async function getAccessToken(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

export async function createInvoiceAction(
  orgId: string,
  payload: { vendor: string; invoiceNumber: string; invoiceDate: string; lineItems: LineItemInput[] },
  idempotencyKey?: string
): Promise<{ invoiceId?: string; error?: string }> {
  try {
    const token = await getAccessToken();
    const invoice = await apiFetch(`/orgs/${orgId}/invoices`, token, {
      method: "POST",
      body: JSON.stringify(payload),
      // Optional: lets the caller safely retry (e.g. after the client-side
      // timeout in apiFetch) without risking a second invoice — see the
      // comment above the route in apps/api/src/routes/invoices.ts.
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    });
    revalidatePath(`/orgs/${orgId}/invoices`);
    return { invoiceId: invoice.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create invoice" };
  }
}

// `version` is the invoice version the edit form originally loaded. The API
// rejects the save with a conflict if the invoice has changed since, instead of
// silently overwriting the other person's changes.
export async function updateInvoiceAction(
  orgId: string,
  invoiceId: string,
  payload: { version: number } & Partial<{
    vendor: string;
    invoiceNumber: string;
    invoiceDate: string;
    lineItems: LineItemInput[];
  }>
): Promise<{ error?: string; conflict?: boolean }> {
  try {
    const token = await getAccessToken();
    await apiFetch(`/orgs/${orgId}/invoices/${invoiceId}`, token, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    revalidatePath(`/orgs/${orgId}/invoices/${invoiceId}`);
    revalidatePath(`/orgs/${orgId}/invoices`);
    return {};
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.code === "VERSION_CONFLICT") {
      return { error: err.message, conflict: true };
    }
    return { error: err instanceof Error ? err.message : "Failed to update invoice" };
  }
}

// `expectedVersion` is the invoice version the user was looking at. The API
// refuses if the invoice has been edited since, so nobody can approve content
// they have not seen. Result flags let the UI say the right thing:
//   conflict        -> someone else changed it; reload and look again
//   outcomeUnknown  -> no response in time; the change MAY have been applied
export async function transitionInvoiceAction(
  orgId: string,
  invoiceId: string,
  toStatus: "REVIEW" | "APPROVED" | "REJECTED",
  expectedVersion: number
): Promise<{ error?: string; conflict?: boolean; outcomeUnknown?: boolean }> {
  try {
    const token = await getAccessToken();
    await apiFetch(`/orgs/${orgId}/invoices/${invoiceId}/transition`, token, {
      method: "POST",
      body: JSON.stringify({ toStatus, expectedVersion }),
    });
    revalidatePath(`/orgs/${orgId}/invoices/${invoiceId}`);
    revalidatePath(`/orgs/${orgId}/invoices`);
    return {};
  } catch (err) {
    if (err instanceof ApiOutcomeUnknownError) {
      return { error: err.message, outcomeUnknown: true };
    }
    if (err instanceof ApiError && err.status === 409 && err.code === "VERSION_CONFLICT") {
      return { error: err.message, conflict: true };
    }
    return { error: err instanceof Error ? err.message : "Failed to update status" };
  }
}
