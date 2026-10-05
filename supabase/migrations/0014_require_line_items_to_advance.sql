-- 0014_require_line_items_to_advance.sql
--
-- An invoice with no line items has a total but nothing behind it, and must
-- not be able to move forward in the approval workflow.
--
-- How such invoices existed: an older API build created the invoice row first
-- and the line items second. When the second step was refused (direct line-item
-- writes were locked down in 0009) the half-made invoice was left behind, in
-- Draft, with a total and no items. create_invoice() (0007) cannot produce
-- these any more, but rows already created that way can still be submitted.
--
-- Rule enforced here, inside the same locked transaction as the status change:
--   * Draft  -> Review    requires at least one line item
--   * Review -> Approved  requires at least one line item
--   * Review -> Rejected  is deliberately NOT blocked: rejecting is the clean
--     way for a reviewer to dispose of an empty invoice that is already in
--     Review. (It also stays terminal, like any other rejection.)
--
-- Everything else in the function is unchanged from 0013.

create or replace function public.transition_invoice(
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

  -- NEW in 0014. Checked after the permission and version checks so that people
  -- who may not act on the invoice learn nothing about its contents, and the
  -- row is already locked (FOR UPDATE above), so the check cannot race with
  -- another request.
  if p_to_status in ('REVIEW', 'APPROVED')
     and not exists (select 1 from line_items where invoice_id = p_invoice_id) then
    raise exception 'This invoice has no line items. Add at least one line item (Edit invoice) before it can move forward.'
      using errcode = '22023';
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

-- create or replace keeps the existing grants; restate them anyway so this
-- file is self-explanatory and safe if it is ever run on its own.
revoke execute on function public.transition_invoice(uuid, invoice_status, integer) from public, anon;
grant  execute on function public.transition_invoice(uuid, invoice_status, integer) to authenticated, service_role;
