-- 0013_review_round_1_hardening.sql
--
-- Fixes from the senior-review pass over Part 2:
--
--   C1  Direct INSERT into invoices was still open (0009 only closed UPDATE),
--       so a member could forge an APPROVED invoice with any total / created_by /
--       approved_by and no line items or audit row.
--   C2  Admins could INSERT/UPDATE/DELETE memberships directly, bypassing the
--       audited add_org_member / update_member_role / remove_org_member functions.
--   --  Client roles still held TRUNCATE (RLS does not apply to TRUNCATE) and
--       DELETE on audit/invoice tables, and anon could EXECUTE internal functions.
--   H1  transition_invoice approved/rejected whatever version was in the table,
--       not the version the reviewer actually looked at.
--   M1  Duplicate protection was case/whitespace sensitive ("Tata Metals" vs
--       "tata metals " + "tm-3842" were all accepted for the same invoice).
--   M2  Blank (whitespace-only) vendor / invoice number / description were accepted.
--   --  SECURITY DEFINER functions now list pg_temp last in search_path.
--   --  INVOICE_EDITED audit entries now record the before/after total.
--
-- Everything the application needs to WRITE goes through SECURITY DEFINER
-- functions; client roles (anon, authenticated) may only SELECT, and only the
-- rows RLS lets them see.

-- ---------------------------------------------------------------------------
-- 0. Pre-flight: refuse to run against data the new rules would reject, and
--    say exactly what to fix, rather than failing with an opaque constraint error.
-- ---------------------------------------------------------------------------
do $$
declare
  v_dups  text;
  v_blank integer;
begin
  select string_agg(g, '; ')
    into v_dups
  from (
    select format('org %s: "%s" / "%s" (%s rows)',
                  organization_id, min(vendor), min(invoice_number), count(*)) as g
    from public.invoices
    group by organization_id, lower(btrim(vendor)), lower(btrim(invoice_number))
    having count(*) > 1
  ) s;
  if v_dups is not null then
    raise exception 'Cannot enforce case-insensitive duplicate protection; existing invoices collide after trimming/case-folding: %', v_dups;
  end if;

  select (select count(*) from public.invoices where btrim(vendor) = '' or btrim(invoice_number) = '')
       + (select count(*) from public.line_items where btrim(description) = '')
    into v_blank;
  if v_blank > 0 then
    raise exception 'Cannot add not-blank constraints: % existing row(s) have a blank vendor, invoice number or line-item description. Fix or remove them first.', v_blank;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. C1 + C2: no direct writes to business tables from client roles.
-- ---------------------------------------------------------------------------
drop policy if exists "invoices insertable by admin or operator" on public.invoices;
drop policy if exists "memberships manageable by admins for other users" on public.memberships;

revoke all on table
  public.invoices, public.line_items, public.memberships, public.activity_log,
  public.idempotency_keys, public.organizations, public.profiles
from anon, authenticated;

-- Read access only; RLS (the existing SELECT policies) still decides which rows.
grant select on table
  public.invoices, public.line_items, public.memberships, public.activity_log,
  public.organizations, public.profiles
to authenticated;

-- Make the safe state the default for tables created later by this role: a new
-- table is invisible to client roles until someone grants access deliberately.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Blank-value checks + case-insensitive duplicate protection (M1, M2).
-- ---------------------------------------------------------------------------
alter table public.invoices
  add constraint invoices_vendor_not_blank         check (btrim(vendor) <> ''),
  add constraint invoices_invoice_number_not_blank check (btrim(invoice_number) <> '');

alter table public.line_items
  add constraint line_items_description_not_blank check (btrim(description) <> '');

alter table public.invoices
  drop constraint invoices_organization_id_vendor_invoice_number_key;

-- The "same vendor + invoice number" rule, compared the way a human would:
-- ignoring case and surrounding whitespace. Still a unique index, so two
-- simultaneous requests are still serialised by the database itself.
create unique index invoices_org_vendor_number_normalized_key
  on public.invoices (organization_id, lower(btrim(vendor)), lower(btrim(invoice_number)));

-- ---------------------------------------------------------------------------
-- 3. compute_invoice_totals: reject blank descriptions, store them trimmed.
-- ---------------------------------------------------------------------------
create or replace function public.compute_invoice_totals(p_line_items jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_elem record;
  v_desc text;
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

    if jsonb_typeof(v_elem.item -> 'description') is distinct from 'string' then
      raise exception 'Line item description is required (1-500 characters)' using errcode = '22023';
    end if;
    v_desc := btrim(v_elem.item ->> 'description');
    if char_length(v_desc) not between 1 and 500 then
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
      'description', v_desc,
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

-- ---------------------------------------------------------------------------
-- 4. create_invoice: trim + reject blank vendor / invoice number.
--    (Otherwise identical to 0012: advisory-lock idempotency, one transaction.)
-- ---------------------------------------------------------------------------
create or replace function public.create_invoice(
  p_organization_id uuid,
  p_vendor text,
  p_invoice_number text,
  p_invoice_date date,
  p_line_items jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role role;
  v_vendor text;
  v_number text;
  v_calc jsonb;
  v_invoice invoices;
  v_elem record;
  v_result jsonb;
  v_request_hash text;
  v_cached_response jsonb;
  v_cached_hash text;
begin
  v_role := current_role_in_org(p_organization_id);
  if v_actor is null or v_role is null or v_role not in ('ADMIN', 'OPERATOR') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  v_vendor := btrim(p_vendor);
  v_number := btrim(p_invoice_number);
  if v_vendor is null or char_length(v_vendor) not between 1 and 255 then
    raise exception 'Vendor is required (1-255 characters, not blank)' using errcode = '22023';
  end if;
  if v_number is null or char_length(v_number) not between 1 and 100 then
    raise exception 'Invoice number is required (1-100 characters, not blank)' using errcode = '22023';
  end if;
  if p_invoice_date is null then
    raise exception 'Invoice date is required' using errcode = '22023';
  end if;
  if p_idempotency_key is not null and char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'Idempotency key must be 1-200 characters' using errcode = '22023';
  end if;

  v_calc := compute_invoice_totals(p_line_items); -- validates + computes totals

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(p_organization_id::text || ':create_invoice:' || p_idempotency_key, 0)
    );

    v_request_hash := md5(
      p_organization_id::text || '|' || p_vendor || '|' || p_invoice_number || '|' ||
      p_invoice_date::text || '|' || (v_calc -> 'lineItems')::text
    );

    select response, request_hash into v_cached_response, v_cached_hash
    from idempotency_keys
    where organization_id = p_organization_id and operation = 'create_invoice' and idempotency_key = p_idempotency_key;

    if found then
      if v_cached_hash <> v_request_hash then
        raise exception 'This idempotency key was already used for a different request' using errcode = '22023';
      end if;
      return v_cached_response; -- genuine retry: same key, same payload -> original result, create nothing
    end if;
  end if;

  insert into invoices (
    organization_id, vendor, invoice_number, invoice_date,
    taxable_amount, tax_amount, total_amount, created_by
  ) values (
    p_organization_id, v_vendor, v_number, p_invoice_date,
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

  v_result := to_jsonb(v_invoice) || jsonb_build_object('lineItems', v_calc -> 'lineItems');

  if p_idempotency_key is not null then
    insert into idempotency_keys (organization_id, operation, idempotency_key, request_hash, actor_id, response)
    values (p_organization_id, 'create_invoice', p_idempotency_key, v_request_hash, v_actor, v_result);
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. update_invoice: trim + reject blanks; audit entry records before/after total.
-- ---------------------------------------------------------------------------
create or replace function public.update_invoice(
  p_organization_id uuid,
  p_invoice_id uuid,
  p_expected_version integer,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
  v_total_before numeric;
  v_changed_fields jsonb;
begin
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

  select coalesce(jsonb_agg(key), '[]'::jsonb) into v_changed_fields
  from jsonb_object_keys(p_patch) as key;

  select * into v_invoice
  from invoices
  where id = p_invoice_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  v_total_before := v_invoice.total_amount;

  if not (v_role = 'ADMIN' or (v_role = 'OPERATOR' and v_invoice.status in ('DRAFT', 'REVIEW'))) then
    if v_invoice.status in ('APPROVED', 'REJECTED') then
      raise exception 'This invoice can no longer be edited' using errcode = '42501';
    end if;
    raise exception 'You do not have permission to edit this invoice' using errcode = '42501';
  end if;

  if v_invoice.version <> p_expected_version then
    raise exception 'This invoice was changed by another user. Refresh before saving again.'
      using errcode = 'PT409';
  end if;

  v_vendor := v_invoice.vendor;
  if p_patch ? 'vendor' then
    if jsonb_typeof(p_patch -> 'vendor') is distinct from 'string'
       or char_length(btrim(p_patch ->> 'vendor')) not between 1 and 255 then
      raise exception 'Vendor must be 1-255 characters (not blank)' using errcode = '22023';
    end if;
    v_vendor := btrim(p_patch ->> 'vendor');
  end if;

  v_number := v_invoice.invoice_number;
  if p_patch ? 'invoiceNumber' then
    if jsonb_typeof(p_patch -> 'invoiceNumber') is distinct from 'string'
       or char_length(btrim(p_patch ->> 'invoiceNumber')) not between 1 and 100 then
      raise exception 'Invoice number must be 1-100 characters (not blank)' using errcode = '22023';
    end if;
    v_number := btrim(p_patch ->> 'invoiceNumber');
  end if;

  v_date := v_invoice.invoice_date;
  if p_patch ? 'invoiceDate' then
    if jsonb_typeof(p_patch -> 'invoiceDate') is distinct from 'string' then
      raise exception 'Invoice date must be a date string' using errcode = '22023';
    end if;
    v_date := (p_patch ->> 'invoiceDate')::date;
  end if;

  v_taxable := v_invoice.taxable_amount;
  v_tax := v_invoice.tax_amount;
  v_total := v_invoice.total_amount;
  if p_patch ? 'lineItems' then
    v_calc := compute_invoice_totals(p_patch -> 'lineItems');
    v_items := v_calc -> 'lineItems';
    v_taxable := (v_calc ->> 'taxableAmount')::numeric;
    v_tax := (v_calc ->> 'taxAmount')::numeric;
    v_total := (v_calc ->> 'totalAmount')::numeric;
  end if;

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
    select coalesce(jsonb_agg(jsonb_build_object(
             'description', description, 'quantity', quantity, 'rate', rate,
             'taxRate', tax_rate, 'amount', amount)), '[]'::jsonb)
    into v_items
    from line_items
    where invoice_id = p_invoice_id;
  end if;

  insert into activity_log (organization_id, invoice_id, actor_id, action, metadata)
  values (p_organization_id, p_invoice_id, v_actor, 'INVOICE_EDITED'::activity_action,
          jsonb_build_object(
            'changedFields', v_changed_fields,
            'status', v_invoice.status,
            'totalBefore', v_total_before,
            'totalAfter', v_total
          ));

  return to_jsonb(v_invoice) || jsonb_build_object('lineItems', v_items);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. H1: transition_invoice now requires the version the actor was looking at.
--    The status-validity check runs first, so the loser of a simultaneous
--    approve-vs-reject still gets "Invalid status transition"; the version
--    check catches the remaining case — the invoice was EDITED while still in
--    the same status (e.g. Review) after the reviewer loaded it.
-- ---------------------------------------------------------------------------
drop function if exists public.transition_invoice(uuid, invoice_status);

create function public.transition_invoice(
  p_invoice_id uuid,
  p_to_status invoice_status,
  p_expected_version integer
)
returns invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice invoices;
  v_old_status invoice_status;
  v_role role;
begin
  if p_expected_version is null then
    raise exception 'version is required' using errcode = '22023';
  end if;

  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  v_old_status := v_invoice.status;

  v_role := current_role_in_org(v_invoice.organization_id);
  if v_role is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not (
    (v_invoice.status = 'DRAFT' and p_to_status = 'REVIEW') or
    (v_invoice.status = 'REVIEW' and p_to_status in ('APPROVED', 'REJECTED'))
  ) then
    raise exception 'Invalid status transition from % to %', v_invoice.status, p_to_status;
  end if;

  if p_to_status in ('APPROVED', 'REJECTED') then
    if v_role not in ('ADMIN', 'REVIEWER') then
      raise exception 'Forbidden' using errcode = '42501';
    end if;
    if v_invoice.created_by = auth.uid() then
      raise exception 'You cannot approve or reject an invoice you created';
    end if;
  else
    if v_role not in ('ADMIN', 'OPERATOR') then
      raise exception 'Forbidden' using errcode = '42501';
    end if;
  end if;

  if v_invoice.version <> p_expected_version then
    raise exception 'This invoice was changed by another user after you opened it. Refresh and review the latest version.'
      using errcode = 'PT409';
  end if;

  update invoices
  set status = p_to_status,
      approved_by = case when p_to_status in ('APPROVED', 'REJECTED') then auth.uid() else approved_by end
  where id = p_invoice_id
    and status = v_old_status
    and version = p_expected_version
  returning * into v_invoice;

  if not found then
    raise exception 'Invoice changed by another request — please refresh and try again'
      using errcode = 'PT409';
  end if;

  insert into activity_log (organization_id, invoice_id, actor_id, action, metadata)
  values (
    v_invoice.organization_id,
    v_invoice.id,
    auth.uid(),
    (case p_to_status
      when 'APPROVED' then 'INVOICE_APPROVED'
      when 'REJECTED' then 'INVOICE_REJECTED'
      else 'INVOICE_SUBMITTED'
    end)::activity_action,
    jsonb_build_object('from', v_old_status, 'to', p_to_status, 'version', p_expected_version)
  );

  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Function privileges + search_path hygiene.
-- ---------------------------------------------------------------------------
-- Only signed-in users may call the business functions; anon / PUBLIC may not.
revoke execute on function public.transition_invoice(uuid, invoice_status, integer) from public, anon;
grant  execute on function public.transition_invoice(uuid, invoice_status, integer) to authenticated, service_role;

revoke execute on function public.current_role_in_org(uuid) from public, anon;
grant  execute on function public.current_role_in_org(uuid) to authenticated, service_role;

-- A trigger function never needs to be callable by clients.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- create_invoice / update_invoice were re-created above: restore the same
-- grant posture they had in 0009 (signed-in users only).
revoke execute on function public.create_invoice(uuid, text, text, date, jsonb, text) from public, anon;
grant  execute on function public.create_invoice(uuid, text, text, date, jsonb, text) to authenticated, service_role;
revoke execute on function public.update_invoice(uuid, uuid, integer, jsonb) from public, anon;
grant  execute on function public.update_invoice(uuid, uuid, integer, jsonb) to authenticated, service_role;

-- pg_temp must come LAST in a SECURITY DEFINER search_path, otherwise Postgres
-- searches it first and a caller-created temp table could shadow a real one.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
