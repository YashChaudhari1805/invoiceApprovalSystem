import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { NewInvoiceForm } from "./form-client";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export default async function NewInvoicePage({ params }: { params: { orgId: string } }) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { orgs } = (await apiFetch("/orgs", session.access_token)) as { orgs: Org[] };
  const currentOrg = orgs.find((o) => o.id === params.orgId);
  if (!currentOrg) redirect("/orgs");

  const canCreate = currentOrg.role === "ADMIN" || currentOrg.role === "OPERATOR";

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="mb-6 font-heading text-xl font-semibold tracking-tight text-ink-950">New invoice</h1>

      {canCreate ? (
        <NewInvoiceForm orgId={params.orgId} />
      ) : (
        <p className="rounded-xl bg-rose-100 px-4 py-3 text-sm text-rose-600">
          You don&apos;t have permission to create invoices in this organization.
        </p>
      )}
    </div>
  );
}
