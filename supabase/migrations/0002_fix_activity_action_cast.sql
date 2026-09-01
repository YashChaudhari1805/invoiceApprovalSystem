-- Fixes: "column action is of type activity_action but expression is of type text"
-- The CASE expression in transition_invoice() returns text by default;
-- it needs an explicit cast to the activity_action enum.

create or replace function transition_invoice(
  p_invoice_id uuid,
  p_to_status invoice_status
) returns invoices as $$
declare
  v_invoice invoices;
  v_role role;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;

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
  returning * into v_invoice;

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
    jsonb_build_object('to', p_to_status)
  );

  return v_invoice;
end;
$$ language plpgsql security definer;
