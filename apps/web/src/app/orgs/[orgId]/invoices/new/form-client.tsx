"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { LineItemsEditor, LineItemDraft, emptyLineItem, getLineItemsError } from "@/components/invoices/line-items-editor";
import { LoadingOverlay } from "@/components/ui/loading-overlay";
import { createInvoiceAction } from "../actions";
import { todayLocalISO } from "@/lib/dates";

export function NewInvoiceForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [vendor, setVendor] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => todayLocalISO());
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per logical "create this invoice" attempt, generated
  // once and reused across any retry of the SAME attempt (a manual retry
  // click after an error, or a future automatic retry) — never regenerated
  // just because handleSubmit runs again. A fresh key naturally only happens
  // on a fresh mount of this form, i.e. a genuinely new invoice draft. See
  // apps/api/src/routes/invoices.ts and migrations/0012_idempotency.sql.
  const idempotencyKey = useRef(crypto.randomUUID());
  // Flipped on once a submit is attempted with invalid line items, so the
  // red inline states in LineItemsEditor only appear after that point
  // rather than greeting a first-time visitor with a wall of red.
  const [showLineItemErrors, setShowLineItemErrors] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // `required` lets "   " through; the API and database reject it, so say so up front.
    if (!vendor.trim() || !invoiceNumber.trim()) {
      setError("Vendor and invoice number can't be blank.");
      return;
    }

    const lineItemsError = getLineItemsError(lineItems);
    if (lineItemsError) {
      setShowLineItemErrors(true);
      setError(lineItemsError);
      return;
    }
    setShowLineItemErrors(false);

    const payload = {
      vendor: vendor.trim(),
      invoiceNumber: invoiceNumber.trim(),
      invoiceDate,
      lineItems: lineItems.map((li) => ({
        description: li.description,
        quantity: Number(li.quantity) || 0,
        rate: Number(li.rate) || 0,
        taxRate: Number(li.taxRate) || 0,
      })),
    };

    startTransition(async () => {
      const result = await createInvoiceAction(orgId, payload, idempotencyKey.current);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/orgs/${orgId}/invoices/${result.invoiceId}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <LoadingOverlay show={isPending} label="Creating invoice…" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Vendor</label>
          <input
            required
            maxLength={255}
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="w-full input-field"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Invoice number</label>
          <input
            required
            maxLength={100}
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            className="w-full input-field"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Invoice date</label>
          <input
            required
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className="w-full input-field"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">Line items</label>
        <LineItemsEditor items={lineItems} onChange={setLineItems} showErrors={showLineItemErrors} />
      </div>

      {error && <p className="alert-error">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="btn-primary"
        >
          {isPending ? "Creating…" : "Create invoice"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm font-medium text-ink-500 transition hover:text-ink-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
