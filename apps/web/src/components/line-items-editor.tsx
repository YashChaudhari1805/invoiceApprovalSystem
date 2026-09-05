"use client";

export interface LineItemDraft {
  description: string;
  quantity: string;
  rate: string;
  taxRate: string;
}

export function emptyLineItem(): LineItemDraft {
  return { description: "", quantity: "1", rate: "", taxRate: "0" };
}

function lineAmount(li: LineItemDraft): number {
  const qty = Number(li.quantity) || 0;
  const rate = Number(li.rate) || 0;
  const taxRate = Number(li.taxRate) || 0;
  const taxable = qty * rate;
  return taxable + taxable * (taxRate / 100);
}

export function computeDraftTotal(items: LineItemDraft[]): number {
  return items.reduce((sum, li) => sum + lineAmount(li), 0);
}

export function LineItemsEditor({
  items,
  onChange,
}: {
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
}) {
  function update(index: number, field: keyof LineItemDraft, value: string) {
    const next = items.slice();
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  }

  function addRow() {
    onChange([...items, emptyLineItem()]);
  }

  function removeRow(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-ink-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="w-20 px-3 py-2 text-right font-medium">Qty</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Rate</th>
              <th className="w-24 px-3 py-2 text-right font-medium">Tax %</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Amount</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {items.map((item, i) => (
              <tr key={i}>
                <td className="px-3 py-1.5">
                  <input
                    value={item.description}
                    onChange={(e) => update(i, "description", e.target.value)}
                    placeholder="Item description"
                    className="w-full rounded border-0 bg-transparent px-1 py-1 text-sm outline-none focus:bg-ink-50"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity}
                    onChange={(e) => update(i, "quantity", e.target.value)}
                    className="w-full rounded border-0 bg-transparent px-1 py-1 text-right text-sm outline-none focus:bg-ink-50"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={item.rate}
                    onChange={(e) => update(i, "rate", e.target.value)}
                    className="w-full rounded border-0 bg-transparent px-1 py-1 text-right text-sm outline-none focus:bg-ink-50"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={item.taxRate}
                    onChange={(e) => update(i, "taxRate", e.target.value)}
                    className="w-full rounded border-0 bg-transparent px-1 py-1 text-right text-sm outline-none focus:bg-ink-50"
                  />
                </td>
                <td className="px-3 py-1.5 text-right text-ink-700">
                  {lineAmount(item).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="text-ink-300 transition hover:text-rose-600"
                      aria-label="Remove line item"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-2 btn-link"
      >
        + Add line item
      </button>

      <div className="mt-3 flex justify-end text-sm">
        <span className="text-ink-500">Total:&nbsp;</span>
        <span className="font-medium text-ink-900">
          ₹{computeDraftTotal(items).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  );
}
