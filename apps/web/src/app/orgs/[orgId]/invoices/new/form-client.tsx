"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LineItemsEditor, LineItemDraft, emptyLineItem } from "@/components/line-items-editor";
import { createInvoiceAction } from "../actions";

export function NewInvoiceForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [vendor, setVendor] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = {
      vendor,
      invoiceNumber,
      invoiceDate,
      lineItems: lineItems.map((li) => ({
        description: li.description,
        quantity: Number(li.quantity) || 0,
        rate: Number(li.rate) || 0,
        taxRate: Number(li.taxRate) || 0,
      })),
    };

    startTransition(async () => {
      const result = await createInvoiceAction(orgId, payload);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/orgs/${orgId}/invoices/${result.invoiceId}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Vendor</label>
          <input
            required
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="w-full input-field"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Invoice number</label>
          <input
            required
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
        <LineItemsEditor items={lineItems} onChange={setLineItems} />
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
