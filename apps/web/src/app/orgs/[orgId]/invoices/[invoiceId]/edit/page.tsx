import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { EditInvoiceForm } from "./form-client";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface InvoiceDetail {
  id: string;
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  lineItems: { description: string; quantity: string | number; rate: string | number; tax_rate: string | number }[];
}

// Mirrors apps/api/src/lib/invoice-rules.ts's canEditInvoice — kept in sync
// by hand since this is UX only. The API independently enforces the real
// rule regardless of what this function decides.
function canEdit(role: string, status: string): boolean {
  if (role === "ADMIN") return true;
  if (role === "OPERATOR") return status === "DRAFT" || status === "REVIEW";
  return false;
}

export default async function EditInvoicePage({
  params,
}: {
  params: { orgId: string; invoiceId: string };
}) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { orgs } = (await apiFetch("/orgs", session.access_token)) as { orgs: Org[] };
  const currentOrg = orgs.find((o) => o.id === params.orgId);
  if (!currentOrg) redirect("/orgs");

  let invoice: InvoiceDetail;
  try {
    invoice = (await apiFetch(
      `/orgs/${params.orgId}/invoices/${params.invoiceId}`,
      session.access_token
    )) as InvoiceDetail;
  } catch {
    notFound();
  }

  if (!canEdit(currentOrg.role, invoice.status)) {
    redirect(`/orgs/${params.orgId}/invoices/${params.invoiceId}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="mb-6 font-heading text-xl font-semibold tracking-tight text-ink-950">
        Edit {invoice.invoice_number}
      </h1>
      <EditInvoiceForm
        orgId={params.orgId}
        invoiceId={invoice.id}
        initialVendor={invoice.vendor}
        initialInvoiceNumber={invoice.invoice_number}
        initialInvoiceDate={invoice.invoice_date}
        initialLineItems={invoice.lineItems}
      />
    </div>
  );
}
