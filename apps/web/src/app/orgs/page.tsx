import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { redirect } from "next/navigation";
import { SignOutLink } from "@/components/sign-out-link";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export default async function OrgsPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  const { orgs } = (await apiFetch("/orgs", session.access_token)) as { orgs: Org[] };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-1 font-heading text-xl font-semibold tracking-tight text-ink-950">
          Your organizations
        </h1>
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-ink-500">Signed in as {session.user.email}</p>
          <SignOutLink className="text-sm font-medium text-accent-600 transition hover:text-accent-700" />
        </div>

        {orgs.length === 0 ? (
          <p className="text-sm text-ink-500">
            You don&apos;t belong to any organizations yet. Ask an Admin to add you.
          </p>
        ) : (
          <ul className="card space-y-1 p-2">
            {orgs.map((org) => (
              <li key={org.id}>
                <Link
                  href={`/orgs/${org.id}/invoices`}
                  className="flex items-center justify-between rounded-xl px-3 py-3 transition hover:bg-ink-50"
                >
                  <span className="font-medium text-ink-900">{org.name}</span>
                  <span className="chip-neutral">
                    {org.role}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
