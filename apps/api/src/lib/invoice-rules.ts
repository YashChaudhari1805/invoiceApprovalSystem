// Pure functions only — no DB, no network. These encode the rules that are
// easiest to get subtly wrong (rounding, off-by-one transition logic), so
// they're isolated here specifically to make them fast and easy to unit test.

export type InvoiceStatus = "DRAFT" | "REVIEW" | "APPROVED" | "REJECTED";
export type Role = "ADMIN" | "OPERATOR" | "REVIEWER" | "VIEWER";

export const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ["REVIEW"],
  REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

export function isValidTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isApprovalStep(to: InvoiceStatus): boolean {
  return to === "APPROVED" || to === "REJECTED";
}

const PERMISSIONS = {
  "invoice:view": ["ADMIN", "OPERATOR", "REVIEWER", "VIEWER"],
  "invoice:create": ["ADMIN", "OPERATOR"],
  "invoice:approve": ["ADMIN", "REVIEWER"],
  "member:manage": ["ADMIN"],
} as const satisfies Record<string, Role[]>;

export function can(role: Role, permission: keyof typeof PERMISSIONS): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

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

// The maker-checker rule, isolated as a pure predicate so it can be unit
// tested without touching the database.
export function canApprove(params: { actorId: string; creatorId: string; role: Role }): boolean {
  if (!can(params.role, "invoice:approve")) return false;
  if (params.actorId === params.creatorId) return false;
  return true;
}

// Edit permission depends on both role AND the invoice's current status —
// Admin can edit regardless of status; Operator only while it's still
// Draft or Review (per the spec's permission matrix).
export function canEditInvoice(params: { role: Role; status: InvoiceStatus }): boolean {
  if (params.role === "ADMIN") return true;
  if (params.role === "OPERATOR") return params.status === "DRAFT" || params.status === "REVIEW";
  return false;
}
