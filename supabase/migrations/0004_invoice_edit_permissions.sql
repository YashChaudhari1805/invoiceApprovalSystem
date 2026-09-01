-- Adds UPDATE support for editing invoices/line items, with two layers of
-- defense against status being changed outside transition_invoice():
--   1. An UPDATE policy that encodes "Admin always, Operator only while
--      Draft/Review" — matching the spec's permission matrix.
--   2. Column-level privileges so `status` itself can never be touched by an
--      ordinary UPDATE from the `authenticated` role at all — only through
--      transition_invoice(), which runs as SECURITY DEFINER and so isn't
--      subject to these grants. This means even a hand-crafted request
--      straight from a browser dev console, bypassing the API entirely,
--      cannot move an invoice's status without going through the whitelist
--      and maker-checker checks in that function.

revoke update on invoices from authenticated;
grant update (vendor, invoice_number, invoice_date, taxable_amount, tax_amount, total_amount)
  on invoices to authenticated;

create policy "invoices editable by admin always or operator while draft or review"
  on invoices for update
  using (
    current_role_in_org(organization_id) = 'ADMIN'
    or (current_role_in_org(organization_id) = 'OPERATOR' and status in ('DRAFT', 'REVIEW'))
  )
  with check (
    current_role_in_org(organization_id) = 'ADMIN'
    or (current_role_in_org(organization_id) = 'OPERATOR' and status in ('DRAFT', 'REVIEW'))
  );

-- Line items follow the same edit-permission rule as their parent invoice —
-- editing an invoice's line items (add/remove/change) is only valid when
-- editing the invoice itself would be valid.
create policy "line items updatable via parent invoice edit permission"
  on line_items for update
  using (
    exists (
      select 1 from invoices
      where invoices.id = line_items.invoice_id
      and (
        current_role_in_org(invoices.organization_id) = 'ADMIN'
        or (current_role_in_org(invoices.organization_id) = 'OPERATOR' and invoices.status in ('DRAFT', 'REVIEW'))
      )
    )
  );

create policy "line items deletable via parent invoice edit permission"
  on line_items for delete
  using (
    exists (
      select 1 from invoices
      where invoices.id = line_items.invoice_id
      and (
        current_role_in_org(invoices.organization_id) = 'ADMIN'
        or (current_role_in_org(invoices.organization_id) = 'OPERATOR' and invoices.status in ('DRAFT', 'REVIEW'))
      )
    )
  );
