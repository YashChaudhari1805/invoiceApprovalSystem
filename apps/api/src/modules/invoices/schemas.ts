import { z } from "zod";

export const lineItemInputSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100),
});

export const createInvoiceSchema = z.object({
  vendor: z.string().min(1).max(255),
  invoiceNumber: z.string().min(1).max(100),
  invoiceDate: z.string().date(), 
  lineItems: z.array(lineItemInputSchema).min(1, "At least one line item is required"),
});

export const updateInvoiceSchema = createInvoiceSchema.partial().extend({
  lineItems: z.array(lineItemInputSchema).min(1).optional(),
});

export const transitionSchema = z.object({
  toStatus: z.enum(["REVIEW", "APPROVED", "REJECTED"]),
});

export const listQuerySchema = z.object({
  search: z.string().optional(),
  vendor: z.string().optional(),
  status: z.enum(["DRAFT", "REVIEW", "APPROVED", "REJECTED"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
