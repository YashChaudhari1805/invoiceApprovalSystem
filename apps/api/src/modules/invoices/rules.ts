// Pure functions only — no DB, no network. These encode the rules that are
// easiest to get subtly wrong (rounding, off-by-one transition logic), so
// they're isolated here specifically to make them fast and easy to unit test.

export {
  ALLOWED_TRANSITIONS,
  isValidTransition,
  isApprovalStep,
  canApprove,
  canEditInvoice,
  INVOICE_STATUSES,
  type InvoiceStatus,
} from "@invoice-app/shared";

export interface LineItemInput {
  description: string;
  quantity: number;
  rate: number;
  taxRate: number; // percentage, e.g. 18 for 18%
}

export interface ComputedLineItem extends LineItemInput {
  amount: number;
}

export interface InvoiceTotals {
  lineItems: ComputedLineItem[];
  taxableAmount: number;
  taxAmount: number;
  totalAmount: number;
}

// NOTE: no longer what decides stored totals. Invoice totals are computed by
// the database (compute_invoice_totals() in migrations/0007, used by
// create_invoice() and update_invoice()) using exact decimal arithmetic, so
// they can't drift from the stored line items. This floating-point version can
// differ from it by one paisa on ~1% of inputs (e.g. 259.78 x 3933.75 is
// exactly 1,021,909.575 -> .58, but the float product rounds down to .57).
// Do not use it to decide, verify or display a stored total; treat the
// database's numbers as the truth. Kept only because its unit tests document
// the intended per-line rounding rules.
//
// Rounds to 2 decimal places at the line-item level before summing, to avoid
// the classic "totals don't match what a human would calculate by hand"
// floating point drift bug.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeInvoiceTotals(lineItems: LineItemInput[]): InvoiceTotals {
  let taxableAmount = 0;
  let taxAmount = 0;

  const computed = lineItems.map((li) => {
    const lineTaxable = round2(li.quantity * li.rate);
    const lineTax = round2(lineTaxable * (li.taxRate / 100));
    taxableAmount += lineTaxable;
    taxAmount += lineTax;
    return { ...li, amount: round2(lineTaxable + lineTax) };
  });

  taxableAmount = round2(taxableAmount);
  taxAmount = round2(taxAmount);

  return {
    lineItems: computed,
    taxableAmount,
    taxAmount,
    totalAmount: round2(taxableAmount + taxAmount),
  };
}
