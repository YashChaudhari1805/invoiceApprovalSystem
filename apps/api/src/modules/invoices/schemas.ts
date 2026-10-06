import { z } from "zod";
import { INVOICE_STATUSES } from "@invoice-app/shared";

export const lineItemInputSchema = z.object({
  // .trim() runs before .min(1): "   " becomes "" and is rejected, exactly as
  // the database (btrim(...) <> '') and the browser form do.
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100),
});

export const createInvoiceSchema = z.object({
  vendor: z.string().trim().min(1).max(255),
  invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.string().date(), 
  lineItems: z.array(lineItemInputSchema).min(1, "At least one line item is required"),
});

// `version` is the invoice version the client originally loaded (optimistic
// locking). It is required: an edit that doesn't say which version it is based
// on can't be checked for staleness, so it would silently overwrite whatever
// another user saved in the meantime.
export const updateInvoiceSchema = createInvoiceSchema.partial().extend({
  version: z.number().int().positive(),
  lineItems: z.array(lineItemInputSchema).min(1).optional(),
});

export const transitionSchema = z.object({
  toStatus: z.enum(["REVIEW", "APPROVED", "REJECTED"]),
  // The version the user was looking at. Required for the same reason as on
  // edits: without it a reviewer could approve content changed after they
  // opened the page.
  expectedVersion: z.number().int().positive(),
});

export const listQuerySchema = z.object({
  search: z.string().optional(),
  vendor: z.string().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
