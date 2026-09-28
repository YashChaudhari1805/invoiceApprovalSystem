-- =============================================================================
-- Atomic invoice creation (4.1)
--
-- Before this migration, POST /orgs/:orgId/invoices made three separate
-- writes from the API: insert the invoice, insert its line items, insert the
-- activity entry. Each was its own transaction, so a failure between them
-- left half-created data behind (an invoice with no/partial line items, or
-- an invoice with no audit entry). The API's "cleanup" DELETE was best-effort
-- only and can itself fail (there is no DELETE policy on invoices).
--
-- create_invoice() does all of it in ONE function call. A Postgres function
-- body runs inside a single transaction, so if anything raises — bad input,
-- a duplicate invoice number, a numeric overflow on the 3rd line item —
-- every write made so far in the call is rolled back. There is no state in
-- which the invoice exists without all of its line items and its activity
-- entry.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- compute_invoice_totals(): validates the line-item payload and does the money
-- arithmetic in the database, so the stored totals can never disagree with the
-- stored line items no matter which client called us. Same rounding rules as
-- apps/api/src/lib/invoice-rules.ts: round each line's taxable amount and tax
-- to 2dp, then sum. (Postgres numeric is exact decimal, so this is not subject
-- to floating-point drift.)
--
-- Internal helper: not callable by API clients directly. It is invoked from
-- SECURITY DEFINER functions, which run as the function owner.
-- Reused by the invoice-edit function in the next step.
-- -----------------------------------------------------------------------------
create or replace function compute_invoice_totals(p_line_items jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_elem record;
  v_qty numeric;
  v_rate numeric;
  v_tax_rate numeric;
  v_line_taxable numeric;
  v_line_tax numeric;
  v_taxable_total numeric := 0;
  v_tax_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
begin
  if p_line_items is null
     or jsonb_typeof(p_line_items) <> 'array'
     or jsonb_array_length(p_line_items) < 1 then
    raise exception 'At least one line item is required' using errcode = '22023';
  end if;

  for v_elem in select value as item from jsonb_array_elements(p_line_items) loop
    if jsonb_typeof(v_elem.item) <> 'object' then
      raise exception 'Each line item must be an object' using errcode = '22023';
    end if;

    if jsonb_typeof(v_elem.item -> 'description') is distinct from 'string'
       or char_length(v_elem.item ->> 'description') not between 1 and 500 then
      raise exception 'Line item description is required (1-500 characters)' using errcode = '22023';
    end if;

    -- Numbers must be real JSON numbers (not strings) so a malformed client
    -- can't sneak in values like "1e400" or "NaN" via implicit casts.
    if jsonb_typeof(v_elem.item -> 'quantity') is distinct from 'number'
       or jsonb_typeof(v_elem.item -> 'rate') is distinct from 'number'
       or jsonb_typeof(v_elem.item -> 'taxRate') is distinct from 'number' then
      raise exception 'Line item quantity, rate and taxRate must be numbers' using errcode = '22023';
    end if;

    v_qty := (v_elem.item ->> 'quantity')::numeric;
    v_rate := (v_elem.item ->> 'rate')::numeric;
    v_tax_rate := (v_elem.item ->> 'taxRate')::numeric;

    if v_qty <= 0 then
      raise exception 'Line item quantity must be greater than zero' using errcode = '22023';
    end if;
    if v_rate < 0 then
      raise exception 'Line item rate cannot be negative' using errcode = '22023';
    end if;
    if v_tax_rate < 0 or v_tax_rate > 100 then
      raise exception 'Line item taxRate must be between 0 and 100' using errcode = '22023';
    end if;

    v_line_taxable := round(v_qty * v_rate, 2);
    v_line_tax := round(v_line_taxable * v_tax_rate / 100, 2);
    v_taxable_total := v_taxable_total + v_line_taxable;
    v_tax_total := v_tax_total + v_line_tax;

    v_items := v_items || jsonb_build_object(
      'description', v_elem.item ->> 'description',
      'quantity', v_qty,
      'rate', v_rate,
      'taxRate', v_tax_rate,
      'amount', v_line_taxable + v_line_tax
    );
  end loop;

  return jsonb_build_object(
    'lineItems', v_items,
    'taxableAmount', v_taxable_total,
    'taxAmount', v_tax_total,
    'totalAmount', v_taxable_total + v_tax_total
  );
end;
$$;

revoke all on function compute_invoice_totals(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- create_invoice(): the single controlled entry point for creating an invoice.
--
--   1. validates the caller may create invoices in this org (Admin/Operator)
--   2. validates + computes totals from the line items (never trusts totals
--      from the client — the API doesn't even send any)
--   3. inserts the invoice, every line item, and the INVOICE_CREATED
--      activity entry
--
-- Any failure anywhere raises, which rolls the whole call back.
--
-- Error contract (SQLSTATE -> what the API does with it):
--   42501  caller has no create permission in this org        -> 403
--   22023  invalid input (bad line item, blank vendor, ...)   -> 400
--   22003  a number is too large for its column               -> 400
--   23505  duplicate (org, vendor, invoice_number)            -> 409
--
-- SECURITY DEFINER (like transition_invoice) so the writes don't depend on the
-- caller's table privileges — but every check uses auth.uid(), and created_by
-- is always auth.uid(), never a client-supplied value.
-- -----------------------------------------------------------------------------
create or replace function create_invoice(
  p_organization_id uuid,
  p_vendor text,
  p_invoice_number text,
  p_invoice_date date,
  p_line_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role role;
  v_calc jsonb;
  v_invoice invoices;
  v_elem record;
begin
  -- 1. Organization access. current_role_in_org() looks at memberships for
  --    auth.uid(); a non-member gets null, and so does an unauthenticated call.
  v_role := current_role_in_org(p_organization_id);
  if v_actor is null or v_role is null or v_role not in ('ADMIN', 'OPERATOR') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  -- Header validation (mirrors the API's zod schema as a database backstop).
  if p_vendor is null or char_length(p_vendor) not between 1 and 255 then
    raise exception 'Vendor is required (1-255 characters)' using errcode = '22023';
  end if;
  if p_invoice_number is null or char_length(p_invoice_number) not between 1 and 100 then
    raise exception 'Invoice number is required (1-100 characters)' using errcode = '22023';
  end if;
  if p_invoice_date is null then
    raise exception 'Invoice date is required' using errcode = '22023';
  end if;

  -- 2. Totals, computed here from the line items themselves.
  v_calc := compute_invoice_totals(p_line_items);

  -- 3. Writes. The unique (organization_id, vendor, invoice_number)
  --    constraint still guards against duplicates, including concurrent ones.
  insert into invoices (
    organization_id, vendor, invoice_number, invoice_date,
    taxable_amount, tax_amount, total_amount, created_by
  ) values (
    p_organization_id, p_vendor, p_invoice_number, p_invoice_date,
    (v_calc ->> 'taxableAmount')::numeric,
    (v_calc ->> 'taxAmount')::numeric,
    (v_calc ->> 'totalAmount')::numeric,
    v_actor
  )
  returning * into v_invoice;

  for v_elem in select value as item from jsonb_array_elements(v_calc -> 'lineItems') loop
    insert into line_items (invoice_id, description, quantity, rate, tax_rate, amount)
    values (
      v_invoice.id,
      v_elem.item ->> 'description',
      (v_elem.item ->> 'quantity')::numeric,
      (v_elem.item ->> 'rate')::numeric,
      (v_elem.item ->> 'taxRate')::numeric,
      (v_elem.item ->> 'amount')::numeric
    );
  end loop;

  insert into activity_log (organization_id, invoice_id, actor_id, action)
  values (p_organization_id, v_invoice.id, v_actor, 'INVOICE_CREATED'::activity_action);

  -- Same response shape the API has always returned: the invoice row (snake_case
  -- columns) plus a camelCase lineItems array.
  return to_jsonb(v_invoice) || jsonb_build_object('lineItems', v_calc -> 'lineItems');
end;
$$;

-- Only signed-in users may call it (and it re-checks membership itself).
revoke all on function create_invoice(uuid, text, text, date, jsonb) from public, anon;
grant execute on function create_invoice(uuid, text, text, date, jsonb) to authenticated;
