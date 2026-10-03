"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { LoadingOverlay } from "@/components/loading-overlay";
import { transitionInvoiceAction } from "../actions";

type ActionKind = "SUBMIT_FOR_REVIEW" | "APPROVE" | "REJECT";

const ACTION_META: Record<
  ActionKind,
  { toStatus: "REVIEW" | "APPROVED" | "REJECTED"; idleLabel: string; pendingLabel: string; toastMessage: (invoiceNumber: string) => string; buttonClass: string }
> = {
  SUBMIT_FOR_REVIEW: {
    toStatus: "REVIEW",
    idleLabel: "Submit for review",
    pendingLabel: "Submitting…",
    toastMessage: (n) => `Invoice ${n} submitted for review.`,
    buttonClass: "btn-primary",
  },
  APPROVE: {
    toStatus: "APPROVED",
    idleLabel: "Approve",
    pendingLabel: "Approving…",
    toastMessage: (n) => `Invoice ${n} approved.`,
    buttonClass: "btn-success",
  },
  REJECT: {
    toStatus: "REJECTED",
    idleLabel: "Reject",
    pendingLabel: "Rejecting…",
    toastMessage: (n) => `Invoice ${n} rejected.`,
    buttonClass: "btn-danger-outline",
  },
};

export function InvoiceActions({
  orgId,
  invoiceId,
  invoiceNumber,
  version,
  availableActions,
}: {
  orgId: string;
  invoiceId: string;
  invoiceNumber: string;
  // The invoice version this page was rendered from; sent with the action so
  // the server can refuse if the invoice has changed since.
  version: number;
  availableActions: string[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  // Which specific action is in flight — lets each button show its own
  // "Approving…" / "Rejecting…" / "Submitting…" label instead of a single
  // generic pending state, while isPending still disables every button so a
  // second click (on this action or another) can't fire a duplicate request.
  const [pendingAction, setPendingAction] = useState<ActionKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handle(action: ActionKind) {
    setError(null);
    setPendingAction(action);
    startTransition(async () => {
      const { toStatus, toastMessage } = ACTION_META[action];
      const result = await transitionInvoiceAction(orgId, invoiceId, toStatus, version);
      setPendingAction(null);
      if (result.outcomeUnknown) {
        // No response in time. The server may still have applied the change,
        // so do NOT claim it failed — re-read the real state instead.
        showToast("error", `No response for invoice ${invoiceNumber} — checking its current status…`);
        setError(null);
        router.refresh();
        return;
      }
      if (result.conflict) {
        // Someone edited or decided this invoice after this page loaded.
        // Reload so the user reviews what is actually there now.
        showToast("error", `Invoice ${invoiceNumber} changed while you had it open — reloaded the latest version.`);
        setError(null);
        router.refresh();
        return;
      }
      if (result.error) {
        // The server answered with an error, so the transaction was rolled
        // back: the status genuinely was NOT changed.
        showToast("error", `Couldn't update invoice ${invoiceNumber} — ${result.error}`);
        setError(result.error);
        return;
      }
      showToast("success", toastMessage(invoiceNumber));
      router.refresh(); // pulls the now-updated status/activity from the server
    });
  }

  if (availableActions.length === 0) return null;

  return (
    <div className="sticky bottom-0 -mx-4 mt-6 border-t border-ink-100 bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      <LoadingOverlay
        show={isPending}
        label={pendingAction ? ACTION_META[pendingAction].pendingLabel : "Working…"}
      />
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
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
        {error && (
          <p role="alert" className="w-full alert-error sm:w-auto">
            {error} — status was not changed.
          </p>
        )}
      </div>
    </div>
  );
}
