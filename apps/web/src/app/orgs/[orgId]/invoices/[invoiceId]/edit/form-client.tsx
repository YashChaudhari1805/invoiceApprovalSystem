"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LineItemsEditor, LineItemDraft, getLineItemsError } from "@/components/line-items-editor";
import { LoadingOverlay } from "@/components/loading-overlay";
import { updateInvoiceAction } from "../../actions";

interface ExistingLineItem {
  description: string;
  quantity: string | number;
  rate: string | number;
  tax_rate: string | number;
}

export function EditInvoiceForm({
  version,
  orgId,
  invoiceId,
  initialVendor,
  initialInvoiceNumber,
  initialInvoiceDate,
  initialLineItems,
}: {
  version: number;
  orgId: string;
  invoiceId: string;
  initialVendor: string;
  initialInvoiceNumber: string;
  initialInvoiceDate: string;
  initialLineItems: ExistingLineItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [vendor, setVendor] = useState(initialVendor);
  const [invoiceNumber, setInvoiceNumber] = useState(initialInvoiceNumber);
  const [invoiceDate, setInvoiceDate] = useState(initialInvoiceDate.slice(0, 10));
  const [lineItems, setLineItems] = useState<LineItemDraft[]>(
    initialLineItems.map((li) => ({
      description: li.description,
      quantity: String(li.quantity),
      rate: String(li.rate),
      taxRate: String(li.tax_rate),
    }))
  );
  const [error, setError] = useState<string | null>(null);
  // True when the save was rejected because someone else changed the invoice
  // after this form loaded it (optimistic-lock conflict).
  const [conflict, setConflict] = useState(false);
  const [showLineItemErrors, setShowLineItemErrors] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConflict(false);

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
      version,
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
      const result = await updateInvoiceAction(orgId, invoiceId, payload);
      if (result.conflict) {
        setConflict(true);
        return;
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/orgs/${orgId}/invoices/${invoiceId}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <LoadingOverlay show={isPending} label="Saving changes…" />
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

      {conflict && (
        <div role="alert" className="alert-error space-y-2">
          <p>This invoice was changed by another user. Refresh before saving again.</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="text-sm font-medium underline underline-offset-2"
          >
            Reload latest version (discards your unsaved changes)
          </button>
        </div>
      )}
      {error && <p className="alert-error">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="btn-primary"
        >
          {isPending ? "Saving…" : "Save changes"}
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
