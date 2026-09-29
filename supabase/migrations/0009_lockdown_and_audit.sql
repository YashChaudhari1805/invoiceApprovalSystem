-- =============================================================================
-- Close the direct-write gaps (6.1-6.3) and make audit history reliable (7)
--
-- Before this migration, an authenticated user who bypassed the API and
-- talked to Supabase directly could:
--   - insert an activity_log row for ANY action, on ANY invoice, claiming to
--     be anyone (well, any actor_id, though RLS-visible actions would still
--     need org membership) — fabricating history ("policy: activity
--     insertable by org members")
--   - UPDATE invoices.taxable_amount / tax_amount / total_amount directly to
--     any value, or edit vendor/invoiceNumber/invoiceDate without going
--     through update_invoice() at all — skipping totals recomputation, the
--     version check, and the audit entry (0004's column grant)
--   - INSERT/UPDATE/DELETE line_items directly, same problem
--   - members.ts logged MEMBER_ADDED/REMOVED/ROLE_CHANGED with a plain
--     `req.supabase.from("activity_log").insert(...)` — itself an instance
--     of the first problem, just from trusted code instead of an attacker
--
-- Fix: revoke the table/column privileges that made those direct writes
-- possible, and provide SECURITY DEFINER functions for the only things that
-- should legitimately write to these tables — exactly the same pattern
-- already used for create_invoice / update_invoice / transition_invoice.
-- Everything below on invoices/line_items/activity_log now happens in one
-- function call per operation, so the business action and its audit entry
-- are always in the same transaction: if one fails, both roll back.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 6.1 Protect activity history
-- -----------------------------------------------------------------------------
drop policy "activity insertable by org members" on activity_log;
revoke insert on activity_log from authenticated, anon;
-- SELECT stays as-is (org members can still read their org's activity feed);
-- there was never an UPDATE/DELETE policy, so the log was already append-only.

-- -----------------------------------------------------------------------------
-- 6.2 Protect invoice totals (and everything else about a header edit)
-- update_invoice() is the only supported path for changing an invoice header
-- now — this closes the gap left by 0004, which still allowed authenticated
-- to UPDATE vendor/invoice_number/invoice_date/taxable_amount/tax_amount/
-- total_amount directly (bypassing totals recomputation, the version check,
-- and the audit entry). `status`/`approved_by` were already unreachable this
-- way since 0001 only granted those specific columns, never those two.
-- -----------------------------------------------------------------------------
revoke update on invoices from authenticated;
-- The "invoices editable by admin always or operator while draft or review"
-- policy from 0004 is left in place (harmless — a privilege check happens
-- before RLS is ever consulted, so an authenticated UPDATE now fails at the
-- privilege check and never reaches it) as a record of the business rule
-- update_invoice() itself now enforces in code.

-- -----------------------------------------------------------------------------
-- 6.3 Protect line-item writes
-- create_invoice() / update_invoice() are SECURITY DEFINER and run as the
-- function owner, so they are unaffected by revoking these grants from
-- `authenticated` — exactly like transition_invoice() still being able to
-- write `status` after 0004 revoked it from direct UPDATEs.
-- -----------------------------------------------------------------------------
revoke insert, update, delete on line_items from authenticated;
-- SELECT stays (line items are still visible via the parent invoice, per 0001).

-- -----------------------------------------------------------------------------
-- Member management: add_org_member / update_member_role / remove_org_member
-- Same shape as create_invoice(): the membership write and its activity_log
-- entry happen in one transaction, so a member action can never succeed
-- without leaving a matching, truthful history entry (and vice versa). This
-- also removes members.ts's dependency on the raw admin/service-role client
-- for the by-email lookup — the function does that internally (SECURITY
-- DEFINER bypasses the "profiles visible within shared orgs" RLS policy that
-- would otherwise hide a not-yet-a-member's profile from the caller), so the
-- API layer no longer needs service-role access for this at all.
--
-- Error contract (SQLSTATE -> what the API does with it):
--   42501  caller is not this org's Admin, or is targeting themselves -> 403
--   P0002  target user / membership not found                        -> 404
--   23505  user is already a member of this org                      -> 409
--   22023  invalid input                                             -> 400
-- -----------------------------------------------------------------------------

create or replace function add_org_member(
  p_organization_id uuid,
  p_email text,
  p_role role
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target_id uuid;
  v_membership memberships;
begin
  if v_actor is null or current_role_in_org(p_organization_id) <> 'ADMIN' then
    raise exception 'Only Admins can manage organization members' using errcode = '42501';
  end if;
  if p_email is null or char_length(p_email) < 1 then
    raise exception 'Email is required' using errcode = '22023';
  end if;
  if p_role is null then
    raise exception 'Role is required' using errcode = '22023';
  end if;

  select id into v_target_id from profiles where email = p_email;
  if v_target_id is null then
    raise exception 'No user found with that email. They must sign up first.' using errcode = 'P0002';
  end if;

  insert into memberships (user_id, organization_id, role)
  values (v_target_id, p_organization_id, p_role)
  returning * into v_membership; -- unique(user_id, organization_id) -> 23505 if already a member

  insert into activity_log (organization_id, actor_id, action, metadata)
  values (p_organization_id, v_actor, 'MEMBER_ADDED', jsonb_build_object('targetUserId', v_target_id, 'role', p_role));

  return jsonb_build_object(
    'id', v_membership.id, 'role', v_membership.role, 'created_at', v_membership.created_at,
    'user', (select jsonb_build_object('id', id, 'name', name, 'email', email) from profiles where id = v_target_id)
  );
end;
$$;

create or replace function update_member_role(
  p_organization_id uuid,
  p_membership_id uuid,
  p_role role
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_before memberships;
  v_membership memberships;
begin
  if v_actor is null or current_role_in_org(p_organization_id) <> 'ADMIN' then
    raise exception 'Only Admins can manage organization members' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'Role is required' using errcode = '22023';
  end if;

  select * into v_before from memberships where id = p_membership_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;

  -- Same rule as 0005's RLS policy, re-checked here since this function
  -- bypasses that policy (SECURITY DEFINER): self-demotion could leave an
  -- org with zero Admins.
  if v_before.user_id = v_actor then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;

  update memberships set role = p_role where id = p_membership_id
  returning * into v_membership;

  insert into activity_log (organization_id, actor_id, action, metadata)
  values (
    p_organization_id, v_actor, 'MEMBER_ROLE_CHANGED',
    jsonb_build_object('membershipId', p_membership_id, 'from', v_before.role, 'to', p_role)
  );

  return jsonb_build_object(
    'id', v_membership.id, 'role', v_membership.role, 'created_at', v_membership.created_at,
    'user', (select jsonb_build_object('id', id, 'name', name, 'email', email) from profiles where id = v_membership.user_id)
  );
end;
$$;

create or replace function remove_org_member(
  p_organization_id uuid,
  p_membership_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_user_id uuid;
begin
  if v_actor is null or current_role_in_org(p_organization_id) <> 'ADMIN' then
    raise exception 'Only Admins can manage organization members' using errcode = '42501';
  end if;

  select user_id into v_user_id from memberships where id = p_membership_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;
  if v_user_id = v_actor then
    raise exception 'You cannot remove yourself from the organization' using errcode = '42501';
  end if;

  delete from memberships where id = p_membership_id;

  insert into activity_log (organization_id, actor_id, action, metadata)
  values (p_organization_id, v_actor, 'MEMBER_REMOVED', jsonb_build_object('removedUserId', v_user_id));
end;
$$;

revoke all on function add_org_member(uuid, text, role) from public, anon;
revoke all on function update_member_role(uuid, uuid, role) from public, anon;
revoke all on function remove_org_member(uuid, uuid) from public, anon;
grant execute on function add_org_member(uuid, text, role) to authenticated;
grant execute on function update_member_role(uuid, uuid, role) to authenticated;
grant execute on function remove_org_member(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Section 7: richer, more honest audit entries
-- -----------------------------------------------------------------------------

-- transition_invoice(): record the FROM status, not just the TO status, so an
-- activity entry alone answers "what changed" without needing to reconstruct
-- it from surrounding rows. (Captured before the UPDATE below overwrites
-- v_invoice with the new row — this is the one behavioral change in this
-- function; everything else is identical to 0006.) Also adds an explicit
-- search_path, closing part of item 9 (SECURITY DEFINER hardening) for this
-- function specifically; the remaining functions from before 0007 are
-- addressed separately.
create or replace function transition_invoice(
  p_invoice_id uuid,
  p_to_status invoice_status
) returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices;
  v_old_status invoice_status;
  v_role role;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found';
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

  update invoices
  set status = p_to_status,
      approved_by = case when p_to_status in ('APPROVED', 'REJECTED') then auth.uid() else approved_by end
  where id = p_invoice_id
    and status = v_old_status
  returning * into v_invoice;

  if not found then
    raise exception 'Invoice status changed by another request — please refresh and try again';
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
    end)::activity_action,  -- explicit cast, required since 0002
    jsonb_build_object('from', v_old_status, 'to', p_to_status)
  );

  return v_invoice;
end;
$$;

-- update_invoice(): the activity entry now records WHICH fields changed
-- (bonus per section 7 — "store a small structured summary of changed
-- fields"), instead of just a bare "this invoice was edited". Everything
-- else is identical to 0008; the only change is building v_changed_fields
-- from p_patch's own keys (already exactly the set of fields the caller
-- asked to change) and passing it as metadata on the activity insert.
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

  -- The set of fields actually present in the patch IS the changed-fields
  -- summary — computed up front, before any values are looked at, so it
  -- reflects the caller's intent even if a value happens to equal the
  -- current one (e.g. resubmitting the same vendor is still "vendor was
  -- part of this edit").
  select coalesce(jsonb_agg(key), '[]'::jsonb) into v_changed_fields
  from jsonb_object_keys(p_patch) as key;

  select * into v_invoice
  from invoices
  where id = p_invoice_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;

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
          jsonb_build_object('changedFields', v_changed_fields));

  return to_jsonb(v_invoice) || jsonb_build_object('lineItems', v_items);
end;
$$;

-- -----------------------------------------------------------------------------
-- Test-only hook: lets the integration suite prove "audit insert fails ->
-- the whole operation rolls back" against a REAL database, instead of that
-- behavior only being reasoned about from reading the function body.
--
-- Concurrency safety: the integration suite runs multiple test files in
-- parallel against the SAME database (see other files' `create_invoice`
-- calls happening at the same time as this one). A trigger that breaks
-- EVERY activity_log insert while "on" would randomly fail unrelated tests
-- running at that moment. To avoid that, the trigger below only fires when
-- a specific Postgres setting is present, and that setting is always set
-- with `is_local => true` (the third argument to set_config), which scopes
-- it to the CURRENT TRANSACTION ONLY — invisible to every other session,
-- including other test files' requests running concurrently against the
-- same database, no matter how they overlap in time. The trigger itself is
-- installed once, permanently, and does nothing unless that transaction-
-- local setting is present.
create or replace function test_activity_log_boom()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('test.break_activity_log', true) = 'true' then
    raise exception 'simulated activity_log failure (test_break_activity_log)' using errcode = 'TE001';
  end if;
  return new;
end;
$$;

create trigger test_activity_log_boom_trigger
  before insert on activity_log
  for each row execute function test_activity_log_boom();

-- Calls create_invoice() as p_actor with the activity_log insert broken for
-- just this one call — everything (impersonation, the break, and the call
-- itself) happens inside this function's single transaction.
--
-- This is safe to ship: it is restricted to `service_role`, the same
-- privilege level the seed script and test admin client already use, and
-- which is never issued to a browser or to `authenticated` API users — the
-- Fastify API itself only ever calls Postgres as `authenticated`, via the
-- caller's own JWT (see apps/api/src/plugins/auth.ts), so this function is
-- unreachable through the running application, only through direct
-- database access with the service-role key.
create or replace function test_create_invoice_with_broken_audit(
  p_actor uuid,
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
begin
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('test.break_activity_log', 'true', true);
  return create_invoice(p_organization_id, p_vendor, p_invoice_number, p_invoice_date, p_line_items);
end;
$$;

revoke all on function test_activity_log_boom() from public, anon, authenticated;
revoke all on function test_create_invoice_with_broken_audit(uuid, uuid, text, text, date, jsonb) from public, anon, authenticated;
grant execute on function test_create_invoice_with_broken_audit(uuid, uuid, text, text, date, jsonb) to service_role;
