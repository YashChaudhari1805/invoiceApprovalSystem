import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";

interface ActivityEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor: { id: string; name: string } | null;
  invoice: { id: string; invoice_number: string } | null;
}

const LABELS: Record<string, (e: ActivityEntry) => string> = {
  INVOICE_CREATED: () => "created invoice",
  INVOICE_EDITED: () => "edited invoice",
  INVOICE_SUBMITTED: () => "submitted invoice for review",
  INVOICE_APPROVED: () => "approved invoice",
  INVOICE_REJECTED: () => "rejected invoice",
  MEMBER_ADDED: () => "added a member",
  MEMBER_REMOVED: () => "removed a member",
  MEMBER_ROLE_CHANGED: (e) => {
    const meta = e.metadata as { from?: string; to?: string } | null;
    return meta?.from && meta?.to ? `changed a member's role: ${meta.from} → ${meta.to}` : "changed a member's role";
  },
};

export default async function ActivityPage({ params }: { params: { orgId: string } }) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { activity } = (await apiFetch(`/orgs/${params.orgId}/activity`, session.access_token)) as {
    activity: ActivityEntry[];
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="mb-6 font-heading text-xl font-semibold tracking-tight text-ink-950">Activity</h1>

      {activity.length === 0 ? (
        <p className="text-sm text-ink-500">No activity yet.</p>
      ) : (
        <ul className="divide-y divide-ink-100 card">
          {activity.map((entry) => {
            const describe = LABELS[entry.action] ?? (() => entry.action.toLowerCase().replace(/_/g, " "));
            return (
              <li key={entry.id} className="flex items-baseline justify-between px-4 py-3 text-sm">
                <span className="text-ink-700">
                  <span className="font-medium text-ink-900">{entry.actor?.name ?? "Someone"}</span>{" "}
                  {describe(entry)}
                  {entry.invoice && (
                    <>
                      {" "}
                      <Link
                        href={`/orgs/${params.orgId}/invoices/${entry.invoice.id}`}
                        className="btn-link"
                      >
                        {entry.invoice.invoice_number}
                      </Link>
                    </>
                  )}
                </span>
                <span className="shrink-0 pl-4 text-xs text-ink-300">
                  {new Date(entry.created_at).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
