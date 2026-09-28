-- =============================================================================
-- Atomic invoice editing (4.2) + optimistic locking
--
-- Two problems with the old PATCH /invoices/:id route:
--
--  1. Not atomic. It updated the invoice row, THEN deleted every line item,
--     THEN re-inserted them, THEN logged activity — four separate writes. If
--     the re-insert failed, the invoice already carried its new totals but had
--     no line items: half-updated, and wrong.
--
--  2. Lost updates. Two people editing the same invoice each loaded it, each
--     saved — and the second save silently overwrote the first, because
--     nothing checked that the invoice was still the one they had loaded.
--
-- Fix for (2): every invoice carries a `version`. It starts at 1 and goes up
-- by one on EVERY update (a trigger does this, so no code path can forget).
-- A client sends back the version it originally loaded; the edit succeeds only
-- if the row is still at that version.
--
-- Fix for (1): update_invoice() performs the version check, the header update,
-- the line-item replacement, the totals recompute and the activity entry in one
-- function call = one transaction. Any failure rolls all of it back, so the
-- previous invoice stays exactly as it was.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- version column + trigger
-- Existing rows get version 1 (a constant default is a metadata-only change in
-- Postgres 11+, so this doesn't rewrite the table).
-- -----------------------------------------------------------------------------
alter table invoices add column version integer not null default 1;

-- Bumped in a trigger rather than in each function so that EVERY update path —
-- update_invoice(), transition_invoice(), or anything added later — advances
-- the version. That is what makes an edit based on an old page fail after the
-- invoice was approved, not just after someone else edited it. Column-level
-- privileges (0004) already stop `authenticated` from writing `version`
-- directly; the trigger also overrides any value an UPDATE tries to set.
create or replace function bump_invoice_version()
returns trigger as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$ language plpgsql;

create trigger invoices_bump_version
  before update on invoices
  for each row execute function bump_invoice_version();

-- -----------------------------------------------------------------------------
-- update_invoice(): the single controlled entry point for editing an invoice.
--
--   p_patch is a jsonb object with any of: vendor, invoiceNumber, invoiceDate,
--   lineItems. Keys that are absent are left unchanged; if lineItems is present
--   it REPLACES all line items and the totals are recomputed from them.
--   status can never be changed here (only transition_invoice() does that).
--
-- Order of checks matters: access first (so an outsider learns nothing, not
-- even whether an invoice exists), then permission, then the version check.
--
-- Error contract (SQLSTATE -> what the API does with it):
--   P0002  invoice not found in this org (or caller not a member) -> 404
--   42501  caller may not edit this invoice in its current status  -> 403
--   PT409  stale version: changed by someone else since it loaded  -> 409
--   22023  invalid input / nothing to update                       -> 400
--   22007  invalid date                                            -> 400
--   22003  a number is too large for its column                    -> 400
--   23505  would duplicate (org, vendor, invoice_number)           -> 409
--
-- PT409 is PostgREST's convention for "respond with HTTP 409"; the API also
-- matches on the code itself, so it doesn't depend on that.
-- -----------------------------------------------------------------------------
create or replace function update_invoice(
  p_organization_id uuid,
  p_invoice_id uuid,
  p_expected_version integer,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role role;
  v_invoice invoices;
  v_calc jsonb;
  v_items jsonb;
  v_elem record;
  v_vendor text;
  v_number text;
  v_date date;
  v_taxable numeric;
  v_tax numeric;
  v_total numeric;
begin
  -- Access. A non-member gets "not found" rather than "forbidden" so this
  -- can't be used to probe which invoices exist in other organizations.
  v_role := current_role_in_org(p_organization_id);
  if v_actor is null or v_role is null then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;

  if p_expected_version is null then
    raise exception 'version is required' using errcode = '22023';
  end if;
  if p_patch is null
     or jsonb_typeof(p_patch) <> 'object'
     or not (p_patch ?| array['vendor', 'invoiceNumber', 'invoiceDate', 'lineItems']) then
    raise exception 'Nothing to update' using errcode = '22023';
  end if;

  -- Lock the row for the rest of this transaction. A concurrent edit or status
  -- transition on the same invoice waits here, then sees the new version.
  select * into v_invoice
  from invoices
  where id = p_invoice_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;

  -- Permission (Admin: any status; Operator: only while Draft/Review) —
  -- evaluated against the freshly locked row, same rule as 0004's UPDATE policy.
  if not (v_role = 'ADMIN' or (v_role = 'OPERATOR' and v_invoice.status in ('DRAFT', 'REVIEW'))) then
    if v_invoice.status in ('APPROVED', 'REJECTED') then
      raise exception 'This invoice can no longer be edited' using errcode = '42501';
    end if;
    raise exception 'You do not have permission to edit this invoice' using errcode = '42501';
  end if;

  -- Optimistic lock: the caller must be editing the version they loaded.
  if v_invoice.version <> p_expected_version then
    raise exception 'This invoice was changed by another user. Refresh before saving again.'
      using errcode = 'PT409';
  end if;

  -- Work out the new header values (absent key = keep current value).
  v_vendor := v_invoice.vendor;
  if p_patch ? 'vendor' then
    if jsonb_typeof(p_patch -> 'vendor') is distinct from 'string'
       or char_length(p_patch ->> 'vendor') not between 1 and 255 then
      raise exception 'Vendor must be 1-255 characters' using errcode = '22023';
    end if;
    v_vendor := p_patch ->> 'vendor';
  end if;

  v_number := v_invoice.invoice_number;
  if p_patch ? 'invoiceNumber' then
    if jsonb_typeof(p_patch -> 'invoiceNumber') is distinct from 'string'
       or char_length(p_patch ->> 'invoiceNumber') not between 1 and 100 then
      raise exception 'Invoice number must be 1-100 characters' using errcode = '22023';
    end if;
    v_number := p_patch ->> 'invoiceNumber';
  end if;

  v_date := v_invoice.invoice_date;
  if p_patch ? 'invoiceDate' then
    if jsonb_typeof(p_patch -> 'invoiceDate') is distinct from 'string' then
      raise exception 'Invoice date must be a date string' using errcode = '22023';
    end if;
    v_date := (p_patch ->> 'invoiceDate')::date; -- malformed -> 22007
  end if;

  v_taxable := v_invoice.taxable_amount;
  v_tax := v_invoice.tax_amount;
  v_total := v_invoice.total_amount;
  if p_patch ? 'lineItems' then
    v_calc := compute_invoice_totals(p_patch -> 'lineItems'); -- validates + computes
    v_items := v_calc -> 'lineItems';
    v_taxable := (v_calc ->> 'taxableAmount')::numeric;
    v_tax := (v_calc ->> 'taxAmount')::numeric;
    v_total := (v_calc ->> 'totalAmount')::numeric;
  end if;

  -- Header first, so a duplicate (vendor, invoice_number) fails fast before
  -- any line items are touched. The version trigger bumps `version` here.
  -- The `version = p_expected_version` guard is defense in depth: the row is
  -- already locked and checked above, so it cannot legitimately match nothing.
  update invoices
  set vendor = v_vendor,
      invoice_number = v_number,
      invoice_date = v_date,
      taxable_amount = v_taxable,
      tax_amount = v_tax,
      total_amount = v_total
  where id = p_invoice_id
    and version = p_expected_version
  returning * into v_invoice;
  if not found then
    raise exception 'This invoice was changed by another user. Refresh before saving again.'
      using errcode = 'PT409';
  end if;

  -- Replace line items. If any insert fails, the delete above it — and the
  -- header update — roll back with it, so the old invoice stays intact.
  if v_items is not null then
    delete from line_items where invoice_id = p_invoice_id;
    for v_elem in select value as item from jsonb_array_elements(v_items) loop
      insert into line_items (invoice_id, description, quantity, rate, tax_rate, amount)
      values (
        p_invoice_id,
        v_elem.item ->> 'description',
        (v_elem.item ->> 'quantity')::numeric,
        (v_elem.item ->> 'rate')::numeric,
        (v_elem.item ->> 'taxRate')::numeric,
        (v_elem.item ->> 'amount')::numeric
      );
    end loop;
  else
    -- Line items unchanged: return the current ones, in the same camelCase shape.
    select coalesce(jsonb_agg(jsonb_build_object(
             'description', description, 'quantity', quantity, 'rate', rate,
             'taxRate', tax_rate, 'amount', amount)), '[]'::jsonb)
    into v_items
    from line_items
    where invoice_id = p_invoice_id;
  end if;

  insert into activity_log (organization_id, invoice_id, actor_id, action)
  values (p_organization_id, p_invoice_id, v_actor, 'INVOICE_EDITED'::activity_action);

  return to_jsonb(v_invoice) || jsonb_build_object('lineItems', v_items);
end;
$$;

revoke all on function update_invoice(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function update_invoice(uuid, uuid, integer, jsonb) to authenticated;
