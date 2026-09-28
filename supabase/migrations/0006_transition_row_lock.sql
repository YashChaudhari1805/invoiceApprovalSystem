-- =============================================================================
-- Fix: Approve-vs-Reject race condition in transition_invoice()
-- (built on the 0002 definition, which added the activity_action cast)
--
-- Before this migration, transition_invoice() read the invoice's status
-- with a plain SELECT, then later ran an UPDATE keyed only on id (no status
-- guard). Under two near-simultaneous calls on the same invoice — e.g. one
-- reviewer clicking Approve while another clicks Reject — both requests
-- could read status = 'REVIEW' before either had committed, both pass the
-- whitelist check, and both successfully UPDATE: whichever transaction's
-- UPDATE committed last silently overwrote the other, with no error
-- returned to the losing request and no record that two conflicting
-- decisions were ever attempted.
--
-- Fix: SELECT ... FOR UPDATE locks the invoice row for the rest of this
-- transaction. A second concurrent call on the same invoice now blocks at
-- that SELECT until the first transaction commits (or rolls back), and once
-- unblocked it reads the *current* row, not a stale one — so it correctly
-- sees status = 'APPROVED' (or 'REJECTED') and fails the whitelist check
-- with a normal "Invalid status transition" error, exactly like any other
-- invalid transition. Only one of the two requests can ever reach the
-- UPDATE with status still 'REVIEW'.
-- =============================================================================

create or replace function transition_invoice(
  p_invoice_id uuid,
  p_to_status invoice_status
) returns invoices as $$
declare
  v_invoice invoices;
  v_role role;
begin
  -- Row lock: serializes any concurrent transition_invoice() calls against
  -- this same invoice for the lifetime of this transaction.
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;

  v_role := current_role_in_org(v_invoice.organization_id);
  if v_role is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  -- Explicit transition whitelist, evaluated against the freshly locked row
  -- — a concurrent transition that already ran and committed while this
  -- call was blocked on the lock above is reflected here.
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

  -- Still guarded by status = v_invoice.status as defense in depth: since
  -- v_invoice was read under FOR UPDATE and nothing else can have changed
  -- it since, this can never filter out the row it just locked, but it
  -- means this UPDATE can never silently no-op if that invariant is ever
  -- broken by a future edit to this function.
  update invoices
  set status = p_to_status,
      approved_by = case when p_to_status in ('APPROVED', 'REJECTED') then auth.uid() else approved_by end
  where id = p_invoice_id
    and status = v_invoice.status
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
    end)::activity_action,  -- explicit cast, as required since 0002
    jsonb_build_object('to', p_to_status)
  );

  return v_invoice;
end;
$$ language plpgsql security definer;
