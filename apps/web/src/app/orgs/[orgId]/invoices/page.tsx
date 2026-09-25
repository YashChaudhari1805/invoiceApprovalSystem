import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";
import { InvoiceFilters } from "@/components/invoice-filters";
import { Pagination } from "@/components/pagination";
import { RevalidateOnFocus } from "@/components/revalidate-on-focus";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface InvoiceRow {
  id: string;
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  total_amount: string | number;
  created_at: string;
}

interface InvoiceSummary {
  draft: number;
  review: number;
  processedRecently: number;
}

// Left-edge status stripe on the mobile card layout — same status→color
// mapping StatusBadge uses, just applied as a border instead of a chip.
const STATUS_STRIPE: Record<string, string> = {
  DRAFT: "border-l-ink-300",
  REVIEW: "border-l-amber-600",
  APPROVED: "border-l-mint-500",
  REJECTED: "border-l-rose-600",
};

function money(n: string | number) {
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default async function InvoiceListPage({
  params,
  searchParams,
}: {
  params: { orgId: string };
  searchParams: { search?: string; vendor?: string; status?: string; page?: string };
}) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const page = Number(searchParams.page ?? "1");
  const pageSize = 20;
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    ...(searchParams.search ? { search: searchParams.search } : {}),
    ...(searchParams.vendor ? { vendor: searchParams.vendor } : {}),
    ...(searchParams.status ? { status: searchParams.status } : {}),
  });

  // The /orgs call here is automatically deduplicated by Next's per-request
  // fetch memoization against the identical call the layout already made —
  // this doesn't add a second network round trip.
  const [{ orgs }, { items, total }, summary] = await Promise.all([
    apiFetch("/orgs", session.access_token) as Promise<{ orgs: Org[] }>,
    apiFetch(`/orgs/${params.orgId}/invoices?${query.toString()}`, session.access_token) as Promise<{
      items: InvoiceRow[];
      total: number;
    }>,
    apiFetch(`/orgs/${params.orgId}/invoices/summary`, session.access_token) as Promise<InvoiceSummary>,
  ]);

  const currentOrg = orgs.find((o) => o.id === params.orgId);
  if (!currentOrg) redirect("/orgs");

  const canCreate = currentOrg.role === "ADMIN" || currentOrg.role === "OPERATOR";

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <RevalidateOnFocus />
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight text-ink-950">Invoices</h1>
          <p className="mt-0.5 text-sm text-ink-500">{currentOrg.name}</p>
        </div>
        {canCreate && (
          <Link
            href={`/orgs/${params.orgId}/invoices/new`}
            className="btn-primary"
          >
            New invoice
          </Link>
        )}
      </div>

      {/* Triage widgets — "what needs my attention right now", answered
          before the user reads a single row of the table below. Always
          reflect the whole org, independent of the filters applied below.
          Stay in 3 columns down to a 320px viewport (padding/gap/type size
          step down at the `sm` breakpoint) rather than stacking to 1 column
          — stacking would push the table below the fold on every phone. */}
      <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
        <Link
          href={`/orgs/${params.orgId}/invoices?status=REVIEW`}
          className="card p-3 transition hover:bg-ink-50 sm:p-4"
        >
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500 sm:text-xs">Pending review</p>
          <p className="mt-1 font-heading text-lg font-semibold text-amber-600 sm:text-2xl">{summary.review}</p>
        </Link>
        <Link
          href={`/orgs/${params.orgId}/invoices?status=DRAFT`}
          className="card p-3 transition hover:bg-ink-50 sm:p-4"
        >
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500 sm:text-xs">Drafts</p>
          <p className="mt-1 font-heading text-lg font-semibold text-ink-700 sm:text-2xl">{summary.draft}</p>
        </Link>
        <div className="card p-3 sm:p-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500 sm:text-xs">Processed (7d)</p>
          <p className="mt-1 font-heading text-lg font-semibold text-mint-500 sm:text-2xl">
            {summary.processedRecently}
          </p>
        </div>
      </div>

      <div className="mb-4">
        <InvoiceFilters />
      </div>

      <div className="overflow-hidden card">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-500">
            No invoices match these filters.
          </p>
        ) : (
          <>
            {/* Desktop: data table. overflow-x-auto on this inner wrapper
                (not the outer card) means a table that's still too wide for
                a narrow desktop window scrolls horizontally within its own
                rounded-corner container instead of the whole card clipping
                it or the page overflowing sideways. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2.5 font-medium">Invoice #</th>
                    <th className="px-4 py-2.5 font-medium">Vendor</th>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {items.map((inv) => (
                    <tr key={inv.id} className="transition hover:bg-ink-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/orgs/${params.orgId}/invoices/${inv.id}`}
                          className="font-medium text-ink-900 hover:text-accent-600"
                        >
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink-700">{inv.vendor}</td>
                      <td className="px-4 py-3 text-ink-500">
                        {new Date(inv.invoice_date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-ink-900">{money(inv.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked cards, edge-accent stripe indicates status at
                a glance without needing to read the chip text first. */}
            <ul className="divide-y divide-ink-100 sm:hidden">
              {items.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/orgs/${params.orgId}/invoices/${inv.id}`}
                    className={`block border-l-4 px-4 py-3 transition hover:bg-ink-50 ${
                      STATUS_STRIPE[inv.status] ?? "border-l-ink-100"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-900">{inv.invoice_number}</p>
                        <p className="truncate text-sm text-ink-500">{inv.vendor}</p>
                      </div>
                      <StatusBadge status={inv.status} />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between text-sm">
                      <span className="text-ink-500">{new Date(inv.invoice_date).toLocaleDateString()}</span>
                      <span className="font-medium text-ink-900">{money(inv.total_amount)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} />
      </div>
    </div>
  );
}
