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
            className="btn-primary"
          >
            Submit for review
          </button>
        )}
        {availableActions.includes("APPROVE") && (
          <button
            onClick={() => handle("APPROVED")}
            disabled={isPending}
            className="btn-success"
          >
            Approve
          </button>
        )}
        {availableActions.includes("REJECT") && (
          <button
            onClick={() => handle("REJECTED")}
            disabled={isPending}
            className="btn-danger-outline"
          >
            Reject
          </button>
        )}
      </div>
      {error && <p className="mt-2 alert-error">{error}</p>}
    </div>
  );
}
