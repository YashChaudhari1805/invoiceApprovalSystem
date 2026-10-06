import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { EditInvoiceForm } from "./form-client";
import { canEditInvoice, type Org, type InvoiceDetail } from "@invoice-app/shared";




export default async function EditInvoicePage(
  props: {
    params: Promise<{ orgId: string; invoiceId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createClient();
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

  if (!canEditInvoice({ role: currentOrg.role, status: invoice.status })) {
    redirect(`/orgs/${params.orgId}/invoices/${params.invoiceId}`);
  }

  return (
    <div className="page page-narrow">
      <h1 className="mb-6 font-heading text-xl font-semibold tracking-tight text-ink-950">
        Edit {invoice.invoice_number}
      </h1>
      {/* keyed on version: when the user chooses "Reload latest" after a
          conflict, the page re-renders with the newer version, the key changes,
          and the form remounts with the fresh values instead of keeping the
          stale ones in its state. */}
      <EditInvoiceForm
        key={invoice.version}
        version={invoice.version}
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
