import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/app-shell";
import type { Org } from "@invoice-app/shared";


export default async function OrgLayout(
  props: {
    children: React.ReactNode;
    params: Promise<{ orgId: string }>;
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { orgs } = (await apiFetch("/orgs", session.access_token)) as { orgs: Org[] };
  const currentOrg = orgs.find((o) => o.id === params.orgId);
  if (!currentOrg) redirect("/orgs");

  return (
    <AppShell orgs={orgs} currentOrgId={params.orgId} currentRole={currentOrg.role} userEmail={session.user.email!}>
      {children}
    </AppShell>
  );
}
