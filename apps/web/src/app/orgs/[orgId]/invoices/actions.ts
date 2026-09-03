"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";

interface LineItemInput {
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
}

async function getAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

export async function createInvoiceAction(
  orgId: string,
  payload: { vendor: string; invoiceNumber: string; invoiceDate: string; lineItems: LineItemInput[] }
): Promise<{ invoiceId?: string; error?: string }> {
  try {
    const token = await getAccessToken();
    const invoice = await apiFetch(`/orgs/${orgId}/invoices`, token, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    revalidatePath(`/orgs/${orgId}/invoices`);
    return { invoiceId: invoice.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create invoice" };
  }
}

export async function updateInvoiceAction(
  orgId: string,
  invoiceId: string,
  payload: Partial<{ vendor: string; invoiceNumber: string; invoiceDate: string; lineItems: LineItemInput[] }>
): Promise<{ error?: string }> {
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
    return { error: err instanceof Error ? err.message : "Failed to update invoice" };
  }
}

export async function transitionInvoiceAction(
  orgId: string,
  invoiceId: string,
  toStatus: "REVIEW" | "APPROVED" | "REJECTED"
): Promise<{ error?: string }> {
  try {
    const token = await getAccessToken();
    await apiFetch(`/orgs/${orgId}/invoices/${invoiceId}/transition`, token, {
      method: "POST",
      body: JSON.stringify({ toStatus }),
    });
    revalidatePath(`/orgs/${orgId}/invoices/${invoiceId}`);
    revalidatePath(`/orgs/${orgId}/invoices`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update status" };
  }
}
