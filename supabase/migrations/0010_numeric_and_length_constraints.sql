-- =============================================================================
-- Section 8: database CHECK constraints (defense in depth)
--
-- These rules were already enforced procedurally inside
-- compute_invoice_totals() (0007) — a client going through create_invoice()
-- or update_invoice() could never violate them. But that's only one layer:
-- nothing at the table level stopped a future migration, an admin script
-- run with the service-role key, or a bug in a not-yet-written function from
-- writing an invalid row directly. CHECK constraints make these rules true
-- of the table itself, independent of which code path (if any) is doing the
-- writing — the point of "defense in depth".
--
-- The rule, chosen and documented once here (matches compute_invoice_totals'
-- procedural checks and the API's zod schema in
-- apps/api/src/modules/invoices/schemas.ts):
--   quantity  > 0        (a zero or negative quantity is not a real line item)
--   rate      >= 0        (0 is allowed — e.g. a free sample line — negative is not)
--   tax_rate  0-100 inclusive
--   vendor / invoice_number / line item description: non-blank, within the
--   same max lengths the API already enforces (255 / 100 / 500 characters)
--
-- All existing rows already satisfy these (they were written exclusively by
-- the validated functions since those existed, and the original seed data
-- was written to satisfy the same rules by hand) — but these are declared
-- NOT VALID and then VALIDATEd as a separate step anyway, so that even on a
-- database with unexpected legacy data, adding the constraint (which blocks
-- future bad writes immediately) can never fail or block on a pre-existing
-- row; VALIDATE CONSTRAINT below then checks the existing data and would
-- surface any violation explicitly, rather than silently.
-- =============================================================================

alter table line_items add constraint line_items_quantity_positive check (quantity > 0) not valid;
alter table line_items add constraint line_items_rate_nonnegative check (rate >= 0) not valid;
alter table line_items add constraint line_items_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100) not valid;
alter table line_items add constraint line_items_description_length check (char_length(description) between 1 and 500) not valid;

alter table invoices add constraint invoices_vendor_length check (char_length(vendor) between 1 and 255) not valid;
alter table invoices add constraint invoices_invoice_number_length check (char_length(invoice_number) between 1 and 100) not valid;
-- Totals are always non-negative by construction (compute_invoice_totals
-- sums non-negative per-line amounts) — this constraint exists purely as a
-- backstop, the same reasoning as creator_not_approver in 0001.
alter table invoices add constraint invoices_totals_nonnegative
  check (taxable_amount >= 0 and tax_amount >= 0 and total_amount >= 0) not valid;

alter table line_items validate constraint line_items_quantity_positive;
alter table line_items validate constraint line_items_rate_nonnegative;
alter table line_items validate constraint line_items_tax_rate_range;
alter table line_items validate constraint line_items_description_length;
alter table invoices validate constraint invoices_vendor_length;
alter table invoices validate constraint invoices_invoice_number_length;
alter table invoices validate constraint invoices_totals_nonnegative;
