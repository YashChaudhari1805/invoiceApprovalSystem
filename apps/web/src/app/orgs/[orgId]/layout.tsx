import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/app-shell";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { orgId: string };
}) {
  const supabase = createClient();
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
