import { fail, type HttpFailure, type PgError } from "../../shared/http";

// Translate Postgres error codes raised by the invoice functions (see
// supabase/migrations) into HTTP responses. One mapper per operation, because
// the same code can mean different things in different operations.

export function mapCreateError(error: PgError): HttpFailure {
  switch (error.code) {
    case "23505":
      // Unique index on (organization_id, lower(btrim(vendor)), lower(btrim(invoice_number))):
      // case/whitespace-insensitive, and what stops two simultaneous identical requests both succeeding.
      return fail(409, "An invoice with this vendor and invoice number already exists");
    case "42501":
      return fail(403, "You do not have permission to create invoices");
    case "22023":
      // Also "this idempotency key was already used for a different request".
      return fail(400, error.message);
    case "22003":
      return fail(400, "A number on this invoice is too large");
    default:
      return fail(500, "Failed to create invoice");
  }
}

export function mapUpdateError(error: PgError): HttpFailure {
  switch (error.code) {
    case "PT409":
      // Optimistic-lock conflict: someone changed this invoice after the client loaded it.
      return fail(409, error.message, { code: "VERSION_CONFLICT" });
    case "23505":
      return fail(409, "An invoice with this vendor and invoice number already exists", { code: "DUPLICATE_INVOICE" });
    case "P0002":
      return fail(404, "Invoice not found");
    case "42501":
      return fail(403, error.message);
    case "22023":
      return fail(400, error.message);
    case "22007":
    case "22008":
      return fail(400, "Invalid invoice date");
    case "22003":
      return fail(400, "A number on this invoice is too large");
    default:
      return fail(500, "Failed to update invoice");
  }
}

export function mapTransitionError(error: PgError): HttpFailure {
  const message = error.message ?? "";
  switch (error.code) {
    case "PT409":
      return fail(409, message, { code: "VERSION_CONFLICT" });
    case "42501":
      return fail(403, "Forbidden");
    case "P0002":
      return fail(404, "Invoice not found");
    case "22023":
      return fail(400, message);
    default:
      // The two remaining business-rule errors use Postgres' default code (P0001),
      // so they can only be told apart by message.
      if (/cannot approve or reject/i.test(message)) return fail(403, message);
      if (/invalid status transition/i.test(message)) return fail(400, message);
      return fail(500, "Failed to update invoice status");
  }
}
