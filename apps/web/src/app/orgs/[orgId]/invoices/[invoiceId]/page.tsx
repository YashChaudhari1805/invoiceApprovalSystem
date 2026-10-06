import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/ui/status-badge";
import { RevalidateOnFocus } from "@/components/system/revalidate-on-focus";
import { InvoiceActions } from "./invoice-actions";
import { formatInvoiceDate } from "@/lib/dates";
import { canEditInvoice, type Org, type InvoiceDetail } from "@invoice-app/shared";





const ACTIVITY_LABELS: Record<string, string> = {
  INVOICE_CREATED: "created this invoice",
  INVOICE_EDITED: "edited this invoice",
  INVOICE_SUBMITTED: "submitted this invoice for review",
  INVOICE_APPROVED: "approved this invoice",
  INVOICE_REJECTED: "rejected this invoice",
};


function money(n: string | number) {
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default async function InvoiceDetailPage(
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

  return (
    <div className="page page-narrow">
      <RevalidateOnFocus />
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-ink-950">
              {invoice.invoice_number}
            </h1>
            <StatusBadge status={invoice.status} large />
          </div>
          <p className="text-sm text-ink-500">{invoice.vendor}</p>
        </div>
      </div>

      {/* Makes the outcome unmissable even if this tab was left open from
          before someone else acted on it — RevalidateOnFocus above is what
          pulls the fresh status in; this is what makes the change legible
          rather than the action buttons just quietly vanishing. */}
      {invoice.status === "APPROVED" && invoice.approver && (
        <div className="mb-4 alert-success">
          Approved by <span className="font-medium">{invoice.approver.name}</span> on{" "}
          {new Date(invoice.updated_at).toLocaleString()}
        </div>
      )}
      {invoice.status === "REJECTED" && invoice.approver && (
        <div className="mb-4 alert-error">
          Rejected by <span className="font-medium">{invoice.approver.name}</span> on{" "}
          {new Date(invoice.updated_at).toLocaleString()}
        </div>
      )}

      {canEditInvoice({ role: currentOrg.role, status: invoice.status }) && (
        <div className="mb-4">
          <Link
            href={`/orgs/${params.orgId}/invoices/${invoice.id}/edit`}
            className="btn-link"
          >
            Edit invoice
          </Link>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 card p-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-ink-500">Created by</p>
          <p className="mt-0.5 font-medium text-ink-900">{invoice.creator?.name ?? "Unknown"}</p>
        </div>
        <div>
          <p className="text-ink-500">Invoice date</p>
          <p className="mt-0.5 font-medium text-ink-900">
            {formatInvoiceDate(invoice.invoice_date)}
          </p>
        </div>
        <div>
          <p className="text-ink-500">Taxable amount</p>
          <p className="mt-0.5 font-medium text-ink-900">{money(invoice.taxable_amount)}</p>
        </div>
        <div>
          <p className="text-ink-500">Tax</p>
          <p className="mt-0.5 font-medium text-ink-900">{money(invoice.tax_amount)}</p>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-medium text-ink-700">Line items</h2>
      <div className="mb-6 overflow-x-auto card">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Rate</th>
              <th className="px-3 py-2 text-right font-medium">Tax %</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {invoice.lineItems.map((li) => (
              <tr key={li.id}>
                <td className="px-3 py-2 text-ink-900">{li.description}</td>
                <td className="px-3 py-2 text-right text-ink-700">{li.quantity}</td>
                <td className="px-3 py-2 text-right text-ink-700">{money(li.rate)}</td>
                <td className="px-3 py-2 text-right text-ink-700">{Number(li.tax_rate)}%</td>
                <td className="px-3 py-2 text-right font-medium text-ink-900">{money(li.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink-100">
              <td colSpan={4} className="px-3 py-2 text-right text-sm font-medium text-ink-700">
                Total
              </td>
              <td className="px-3 py-2 text-right text-sm font-semibold text-ink-950">
                {money(invoice.total_amount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-medium text-ink-700">Activity</h2>
      <ul className="space-y-3 card p-4">
        {invoice.activity.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
            <span className="text-ink-700">
              <span className="font-medium text-ink-900">{entry.actor?.name ?? "Someone"}</span>{" "}
              {ACTIVITY_LABELS[entry.action] ?? entry.action.toLowerCase().replace(/_/g, " ")}
            </span>
            <span className="shrink-0 text-xs text-ink-300">
              {new Date(entry.created_at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>

      {/* Sticky action footer — stays reachable at the bottom of the
          viewport rather than scrolling away, per the "decision sandbox"
          spec. Renders nothing when there's nothing this user can do
          (wrong status, wrong role, or they're the maker on their own
          invoice), so it costs no vertical space in those cases. */}
      <InvoiceActions
        orgId={params.orgId}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        version={invoice.version}
        availableActions={invoice.availableActions}
      />
    </div>
  );
}
