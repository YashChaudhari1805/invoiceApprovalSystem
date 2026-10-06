import { can, type Role } from "./roles";

export const INVOICE_STATUSES = ["DRAFT", "REVIEW", "APPROVED", "REJECTED"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  REVIEW: "In review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

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

/** Maker-checker: the person who created an invoice can never approve it. */
export function canApprove(params: { actorId: string; creatorId: string; role: Role }): boolean {
  if (!can(params.role, "invoice:approve")) return false;
  return params.actorId !== params.creatorId;
}

/** Admin can edit at any status; Operator only while Draft or In review. */
export function canEditInvoice(params: { role: Role; status: InvoiceStatus }): boolean {
  if (params.role === "ADMIN") return true;
  if (params.role === "OPERATOR") return params.status === "DRAFT" || params.status === "REVIEW";
  return false;
}
