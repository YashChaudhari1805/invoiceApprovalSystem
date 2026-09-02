import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { InvoiceFilters } from "@/components/invoice-filters";
import { Pagination } from "@/components/pagination";

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

  const { orgs } = (await apiFetch("/orgs", session.access_token)) as { orgs: Org[] };
  const currentOrg = orgs.find((o) => o.id === params.orgId);
  if (!currentOrg) redirect("/orgs"); // not a member of this org — bounce rather than 403 a page render

  const page = Number(searchParams.page ?? "1");
  const pageSize = 20;
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    ...(searchParams.search ? { search: searchParams.search } : {}),
    ...(searchParams.vendor ? { vendor: searchParams.vendor } : {}),
    ...(searchParams.status ? { status: searchParams.status } : {}),
  });

  const { items, total } = (await apiFetch(
    `/orgs/${params.orgId}/invoices?${query.toString()}`,
    session.access_token
  )) as { items: InvoiceRow[]; total: number };

  const canCreate = currentOrg.role === "ADMIN" || currentOrg.role === "OPERATOR";

  return (
    <AppShell orgs={orgs} currentOrgId={params.orgId} currentRole={currentOrg.role} userEmail={session.user.email!}>
      <div className="mx-auto max-w-5xl px-8 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight text-ink-950">Invoices</h1>
            <p className="mt-0.5 text-sm text-ink-500">{currentOrg.name}</p>
          </div>
          {canCreate && (
            <Link
              href={`/orgs/${params.orgId}/invoices/new`}
              className="rounded-md bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-700"
            >
              New invoice
            </Link>
          )}
        </div>

        <div className="mb-4">
          <InvoiceFilters />
        </div>

        <div className="overflow-hidden rounded-lg border border-ink-100 bg-white">
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-500">
              No invoices match these filters.
            </p>
          ) : (
            <table className="w-full text-sm">
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
                    <td className="px-4 py-3 text-right font-medium text-ink-900">
                      ₹{Number(inv.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={page} pageSize={pageSize} total={total} />
        </div>
      </div>
    </AppShell>
  );
}
