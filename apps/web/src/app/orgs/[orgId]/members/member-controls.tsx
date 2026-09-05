"use client";

import { useState, useTransition } from "react";
import { addMemberAction, updateMemberRoleAction, removeMemberAction } from "./actions";

const ROLES = ["ADMIN", "OPERATOR", "REVIEWER", "VIEWER"] as const;

interface Member {
  id: string;
  role: string;
  created_at: string;
  user: { id: string; name: string; email: string };
}

export function MemberRow({
  orgId,
  member,
  isSelf,
}: {
  orgId: string;
  member: Member;
  isSelf: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  function handleRoleChange(role: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateMemberRoleAction(orgId, member.id, role as any);
      if (result.error) setError(result.error);
    });
  }

  function handleRemove() {
    if (!confirm(`Remove ${member.user.name} from this organization?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await removeMemberAction(orgId, member.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRemoved(true);
    });
  }

  if (removed) return null;

  return (
    <tr>
      <td className="px-4 py-3">
        <p className="font-medium text-ink-900">{member.user.name}</p>
        <p className="text-xs text-ink-500">{member.user.email}</p>
      </td>
      <td className="px-4 py-3">
        <select
          value={member.role}
          disabled={isPending || isSelf}
          onChange={(e) => handleRoleChange(e.target.value)}
          className="input-field"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {isSelf && <p className="mt-1 text-xs text-ink-300">Can&apos;t change your own role</p>}
      </td>
      <td className="px-4 py-3 text-right">
        {!isSelf && (
          <button
            onClick={handleRemove}
            disabled={isPending}
            className="text-xs font-medium text-ink-500 transition hover:text-rose-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </td>
      {error && (
        <td colSpan={3} className="px-4 pb-2">
          <p className="text-xs text-rose-600">{error}</p>
        </td>
      )}
    </tr>
  );
}

export function AddMemberForm({ orgId }: { orgId: string }) {
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addMemberAction(orgId, email, role);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEmail("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-primary"
      >
        Add member
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-start gap-2">
      <div>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          className="w-56 input-field"
        />
        {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      </div>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
        className="rounded-xl border border-ink-100 bg-surface px-2 py-2 text-sm outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary"
      >
        {isPending ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2 py-2 text-sm font-medium text-ink-500 transition hover:text-ink-700"
      >
        Cancel
      </button>
    </form>
  );
}
