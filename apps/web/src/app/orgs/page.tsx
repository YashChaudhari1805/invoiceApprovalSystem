import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { redirect } from "next/navigation";

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
    <div className="flex min-h-screen items-center justify-center bg-wash-radial px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-1 font-heading text-xl font-semibold tracking-tight text-ink-950">
          Your organizations
        </h1>
        <p className="mb-6 text-sm text-ink-500">
          Signed in as {session.user.email}
        </p>

        {orgs.length === 0 ? (
          <p className="text-sm text-ink-500">
            You don&apos;t belong to any organizations yet. Ask an Admin to add you.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100 bg-white">
            {orgs.map((org) => (
              <li key={org.id}>
                <Link
                  href={`/orgs/${org.id}/invoices`}
                  className="flex items-center justify-between px-4 py-3.5 transition hover:bg-ink-50"
                >
                  <span className="font-medium text-ink-900">{org.name}</span>
                  <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-700">
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
