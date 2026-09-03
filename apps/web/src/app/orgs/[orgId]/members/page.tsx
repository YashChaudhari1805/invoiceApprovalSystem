import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { MemberRow, AddMemberForm } from "./member-controls";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface Member {
  id: string;
  role: string;
  created_at: string;
  user: { id: string; name: string; email: string };
}

export default async function MembersPage({ params }: { params: { orgId: string } }) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { orgs } = (await apiFetch("/orgs", session.access_token)) as { orgs: Org[] };
  const currentOrg = orgs.find((o) => o.id === params.orgId);
  if (!currentOrg) redirect("/orgs");

  // The whole members screen is Admin-only per the spec. The API enforces
  // this independently (403 on every route in routes/members.ts) — this is
  // just a friendlier redirect instead of showing an error-filled page.
  if (currentOrg.role !== "ADMIN") {
    redirect(`/orgs/${params.orgId}/invoices`);
  }

  const { members } = (await apiFetch(`/orgs/${params.orgId}/members`, session.access_token)) as {
    members: Member[];
  };

  return (
    <AppShell orgs={orgs} currentOrgId={params.orgId} currentRole={currentOrg.role} userEmail={session.user.email!}>
      <div className="mx-auto max-w-3xl px-8 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight text-ink-950">Members</h1>
            <p className="mt-0.5 text-sm text-ink-500">{currentOrg.name}</p>
          </div>
          <AddMemberForm orgId={params.orgId} />
        </div>

        <div className="overflow-hidden rounded-lg border border-ink-100 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {members.map((m) => (
                <MemberRow key={m.id} orgId={params.orgId} member={m} isSelf={m.user.id === session.user.id} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
