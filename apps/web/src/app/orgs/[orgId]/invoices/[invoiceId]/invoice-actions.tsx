"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionInvoiceAction } from "../actions";

export function InvoiceActions({
  orgId,
  invoiceId,
  availableActions,
}: {
  orgId: string;
  invoiceId: string;
  availableActions: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle(toStatus: "REVIEW" | "APPROVED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const result = await transitionInvoiceAction(orgId, invoiceId, toStatus);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (availableActions.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2">
        {availableActions.includes("SUBMIT_FOR_REVIEW") && (
          <button
            onClick={() => handle("REVIEW")}
            disabled={isPending}
            className="rounded-md bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-700 disabled:opacity-50"
          >
            Submit for review
          </button>
        )}
        {availableActions.includes("APPROVE") && (
          <button
            onClick={() => handle("APPROVED")}
            disabled={isPending}
            className="rounded-md bg-mint-500 px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Approve
          </button>
        )}
        {availableActions.includes("REJECT") && (
          <button
            onClick={() => handle("REJECTED")}
            disabled={isPending}
            className="rounded-md border border-rose-600 px-3.5 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
          >
            Reject
          </button>
        )}
      </div>
      {error && <p className="mt-2 rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
