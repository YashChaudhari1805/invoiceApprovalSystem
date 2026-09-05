import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";
import { InvoiceActions } from "./invoice-actions";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface LineItem {
  id: string;
  description: string;
  quantity: string | number;
  rate: string | number;
  tax_rate: string | number;
  amount: string | number;
}

interface ActivityEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor: { id: string; name: string } | null;
}

interface InvoiceDetail {
  id: string;
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  taxable_amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  created_by: string;
  created_at: string;
  creator: { id: string; name: string; email: string } | null;
  approver: { id: string; name: string; email: string } | null;
  lineItems: LineItem[];
  activity: ActivityEntry[];
  availableActions: string[];
}

const ACTIVITY_LABELS: Record<string, string> = {
  INVOICE_CREATED: "created this invoice",
  INVOICE_EDITED: "edited this invoice",
  INVOICE_SUBMITTED: "submitted this invoice for review",
  INVOICE_APPROVED: "approved this invoice",
  INVOICE_REJECTED: "rejected this invoice",
};

// Mirrors apps/api/src/lib/invoice-rules.ts's canEditInvoice — UX only, the
// API independently enforces the real rule.
function canEdit(role: string, status: string): boolean {
  if (role === "ADMIN") return true;
  if (role === "OPERATOR") return status === "DRAFT" || status === "REVIEW";
  return false;
}

function money(n: string | number) {
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default async function InvoiceDetailPage({
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

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-ink-950">
              {invoice.invoice_number}
            </h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="text-sm text-ink-500">{invoice.vendor}</p>
        </div>
        <InvoiceActions orgId={params.orgId} invoiceId={invoice.id} availableActions={invoice.availableActions} />
      </div>

      {canEdit(currentOrg.role, invoice.status) && (
        <div className="mb-4">
          <Link
            href={`/orgs/${params.orgId}/invoices/${invoice.id}/edit`}
            className="btn-link"
          >
            Edit invoice
          </Link>
        </div>
      )}

      <div className="mb-6 grid grid-cols-4 gap-4 card p-4 text-sm">
        <div>
          <p className="text-ink-500">Created by</p>
          <p className="mt-0.5 font-medium text-ink-900">{invoice.creator?.name ?? "Unknown"}</p>
        </div>
        <div>
          <p className="text-ink-500">Invoice date</p>
          <p className="mt-0.5 font-medium text-ink-900">
            {new Date(invoice.invoice_date).toLocaleDateString()}
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
      <div className="mb-6 overflow-hidden card">
        <table className="w-full text-sm">
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
          <li key={entry.id} className="flex items-baseline justify-between text-sm">
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
    </div>
  );
}
