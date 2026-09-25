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

interface LineItemFieldErrors {
  description?: string;
  quantity?: string;
  rate?: string;
}

// Previously a line item with a missing description or a 0/negative
// quantity or rate would silently compute a ₹0.00 amount and only surface
// as a rejection after hitting submit. This flags it inline, at the field
// level, before the user ever gets that far.
function lineItemErrors(li: LineItemDraft): LineItemFieldErrors {
  const errors: LineItemFieldErrors = {};
  if (!li.description.trim()) errors.description = "Required";

  const qty = Number(li.quantity);
  if (li.quantity.trim() === "" || Number.isNaN(qty) || qty <= 0) {
    errors.quantity = "Must be greater than 0";
  }

  const rate = Number(li.rate);
  if (li.rate.trim() === "" || Number.isNaN(rate) || rate <= 0) {
    errors.rate = "Must be greater than 0";
  }

  return errors;
}

/**
 * Validates the whole draft before submit. Returns a human-readable error
 * for the form's top-level banner, or null when every row is valid.
 * Exported so the create/edit forms can block submission and flip on
 * `showErrors` without duplicating these rules.
 */
export function getLineItemsError(items: LineItemDraft[]): string | null {
  if (items.length === 0) return "Add at least one line item.";
  const invalidIndex = items.findIndex((li) => Object.keys(lineItemErrors(li)).length > 0);
  if (invalidIndex !== -1) {
    return `Line item ${invalidIndex + 1} needs a description, a quantity greater than 0, and a rate greater than 0.`;
  }
  return null;
}

export function LineItemsEditor({
  items,
  onChange,
  showErrors = false,
}: {
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  // Set to true by the parent form after a failed submit attempt, so a
  // first-time visitor isn't shown a wall of red before they've typed
  // anything. Once true, errors update live as the user fixes each field.
  showErrors?: boolean;
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
      {/* Desktop/tablet: dense table, one row per line item. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-ink-100 sm:block">
        <table className="w-full min-w-[520px] text-sm">
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
            {items.map((item, i) => {
              const errors = showErrors ? lineItemErrors(item) : {};
              const fieldClass = (invalid?: string) =>
                `w-full rounded border-0 bg-transparent px-1 py-1 text-sm outline-none focus:bg-ink-50 ${
                  invalid ? "bg-rose-100/60 text-rose-600 focus:bg-rose-100/60" : ""
                }`;
              return (
                <tr key={i}>
                  <td className="px-3 py-1.5 align-top">
                    <input
                      value={item.description}
                      onChange={(e) => update(i, "description", e.target.value)}
                      placeholder="Item description"
                      aria-invalid={!!errors.description}
                      className={fieldClass(errors.description)}
                    />
                    {errors.description && <p className="px-1 text-xs text-rose-600">{errors.description}</p>}
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={item.quantity}
                      onChange={(e) => update(i, "quantity", e.target.value)}
                      aria-invalid={!!errors.quantity}
                      className={`text-right ${fieldClass(errors.quantity)}`}
                    />
                    {errors.quantity && <p className="text-right text-xs text-rose-600">{errors.quantity}</p>}
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={item.rate}
                      onChange={(e) => update(i, "rate", e.target.value)}
                      aria-invalid={!!errors.rate}
                      className={`text-right ${fieldClass(errors.rate)}`}
                    />
                    {errors.rate && <p className="text-right text-xs text-rose-600">{errors.rate}</p>}
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={item.taxRate}
                      onChange={(e) => update(i, "taxRate", e.target.value)}
                      className="w-full rounded border-0 bg-transparent px-1 py-1 text-right text-sm outline-none focus:bg-ink-50"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right align-top text-ink-700">
                    {lineAmount(item).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-2 py-1.5 text-right align-top">
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
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: one card per line item — a 6-column row (qty/rate/tax%/
          amount/description/remove) has no honest way to fit a 320px
          screen, so this is a distinct layout rather than a squeezed
          version of the table above. */}
      <ul className="space-y-3 sm:hidden">
        {items.map((item, i) => {
          const errors = showErrors ? lineItemErrors(item) : {};
          return (
          <li key={i} className="rounded-2xl border border-ink-100 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="w-full">
                <input
                  value={item.description}
                  onChange={(e) => update(i, "description", e.target.value)}
                  placeholder="Item description"
                  aria-label="Description"
                  aria-invalid={!!errors.description}
                  className={`w-full rounded border-0 bg-transparent px-1 py-1 text-sm font-medium outline-none focus:bg-ink-50 ${
                    errors.description ? "bg-rose-100/60 text-rose-600" : "text-ink-900"
                  }`}
                />
                {errors.description && <p className="px-1 text-xs text-rose-600">{errors.description}</p>}
              </div>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="shrink-0 px-1 text-ink-300 transition hover:text-rose-600"
                  aria-label="Remove line item"
                >
                  ×
                </button>
              )}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="block">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-ink-500">Qty</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={item.quantity}
                  onChange={(e) => update(i, "quantity", e.target.value)}
                  aria-invalid={!!errors.quantity}
                  className={`mt-0.5 w-full input-field px-2 py-1 text-right text-sm ${
                    errors.quantity ? "border-rose-600 text-rose-600" : ""
                  }`}
                />
                {errors.quantity && <p className="mt-0.5 text-[10px] text-rose-600">{errors.quantity}</p>}
              </label>
              <label className="block">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-ink-500">Rate</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={item.rate}
                  onChange={(e) => update(i, "rate", e.target.value)}
                  aria-invalid={!!errors.rate}
                  className={`mt-0.5 w-full input-field px-2 py-1 text-right text-sm ${
                    errors.rate ? "border-rose-600 text-rose-600" : ""
                  }`}
                />
                {errors.rate && <p className="mt-0.5 text-[10px] text-rose-600">{errors.rate}</p>}
              </label>
              <label className="block">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-ink-500">Tax %</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={item.taxRate}
                  onChange={(e) => update(i, "taxRate", e.target.value)}
                  className="mt-0.5 w-full input-field px-2 py-1 text-right text-sm"
                />
              </label>
            </div>
            <p className="mt-2 text-right text-sm text-ink-700">
              Amount:{" "}
              <span className="font-medium text-ink-900">
                {lineAmount(item).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </p>
          </li>
          );
        })}
      </ul>

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
