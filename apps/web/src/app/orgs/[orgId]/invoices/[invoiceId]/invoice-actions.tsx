"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionInvoiceAction } from "../actions";

type ActionKind = "SUBMIT_FOR_REVIEW" | "APPROVE" | "REJECT";

const ACTION_META: Record<
  ActionKind,
  { toStatus: "REVIEW" | "APPROVED" | "REJECTED"; idleLabel: string; pendingLabel: string; successMessage: string; buttonClass: string }
> = {
  SUBMIT_FOR_REVIEW: {
    toStatus: "REVIEW",
    idleLabel: "Submit for review",
    pendingLabel: "Submitting…",
    successMessage: "Invoice submitted for review.",
    buttonClass: "btn-primary",
  },
  APPROVE: {
    toStatus: "APPROVED",
    idleLabel: "Approve",
    pendingLabel: "Approving…",
    successMessage: "Invoice approved.",
    buttonClass: "btn-success",
  },
  REJECT: {
    toStatus: "REJECTED",
    idleLabel: "Reject",
    pendingLabel: "Rejecting…",
    successMessage: "Invoice rejected.",
    buttonClass: "btn-danger-outline",
  },
};

// How long the success banner stays up before clearing itself, so it doesn't
// linger forever if the user starts poking around the page afterward.
const SUCCESS_BANNER_MS = 4000;

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
  // Which specific action is in flight — lets each button show its own
  // "Approving…" / "Rejecting…" / "Submitting…" label instead of a single
  // generic pending state, while isPending still disables every button so a
  // second click (on this action or another) can't fire a duplicate request.
  const [pendingAction, setPendingAction] = useState<ActionKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(null), SUCCESS_BANNER_MS);
    return () => clearTimeout(timeout);
  }, [success]);

  function handle(action: ActionKind) {
    setError(null);
    setSuccess(null);
    setPendingAction(action);
    startTransition(async () => {
      const { toStatus, successMessage } = ACTION_META[action];
      const result = await transitionInvoiceAction(orgId, invoiceId, toStatus);
      setPendingAction(null);
      if (result.error) {
        // Something went wrong — the invoice's status was NOT changed. Make
        // that unambiguous rather than leaving the user guessing whether a
        // slow request actually went through.
        setError(result.error);
        return;
      }
      setSuccess(successMessage);
      router.refresh(); // pulls the now-updated status/activity from the server
    });
  }

  if (availableActions.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2">
        {(["SUBMIT_FOR_REVIEW", "APPROVE", "REJECT"] as ActionKind[])
          .filter((action) => availableActions.includes(action))
          .map((action) => {
            const meta = ACTION_META[action];
            return (
              <button
                key={action}
                onClick={() => handle(action)}
                disabled={isPending}
                aria-busy={pendingAction === action}
                className={meta.buttonClass}
              >
                {pendingAction === action ? meta.pendingLabel : meta.idleLabel}
              </button>
            );
          })}
      </div>
      {error && (
        <p role="alert" className="mt-2 alert-error">
          {error} — the invoice status was not changed. Please try again.
        </p>
      )}
      {success && (
        <p role="status" className="mt-2 alert-success">
          {success}
        </p>
      )}
    </div>
  );
}
