import type { InvoiceStatus } from "./invoice";
import type { Role } from "./roles";

// Response shapes of the API, written once. Postgres numerics arrive as
// strings or numbers depending on the column, hence `Numeric`.
export type Numeric = string | number;

export interface Org {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface Person {
  id: string;
  name: string;
  email: string;
}

export interface InvoiceListItem {
  id: string;
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  status: InvoiceStatus;
  total_amount: Numeric;
  created_at: string;
  created_by: string;
}

export interface InvoiceList {
  items: InvoiceListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InvoiceSummary {
  draft: number;
  review: number;
  processedRecently: number;
}

export interface LineItem {
  id: string;
  description: string;
  quantity: Numeric;
  rate: Numeric;
  tax_rate: Numeric;
  amount: Numeric;
}

export interface ActivityEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor: { id: string; name: string } | null;
  invoice?: { id: string; invoice_number: string } | null;
}

export type InvoiceAction = "SUBMIT_FOR_REVIEW" | "APPROVE" | "REJECT";

export interface InvoiceDetail extends Omit<InvoiceListItem, "total_amount"> {
  version: number;
  taxable_amount: Numeric;
  tax_amount: Numeric;
  total_amount: Numeric;
  updated_at: string;
  creator: Person | null;
  approver: Person | null;
  lineItems: LineItem[];
  activity: ActivityEntry[];
  availableActions: InvoiceAction[];
}

export interface Member {
  id: string;
  role: Role;
  created_at: string;
  user: Person;
}

/** `code` lets the UI tell a stale edit from a duplicate invoice (both are HTTP 409). */
export type ApiErrorCode = "VERSION_CONFLICT" | "DUPLICATE_INVOICE";
