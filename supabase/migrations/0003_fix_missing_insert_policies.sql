-- Fixes: invoice creation failing with a 500 because line_items and
-- activity_log had SELECT policies but no INSERT policy — RLS defaults to
-- deny, so those inserts were being silently rejected by Postgres.

-- line_items: insertable only if the caller is Admin or Operator in the
-- parent invoice's organization — mirrors the invoices insert policy,
-- since a line item is meaningless without its invoice's own permissions.
create policy "line items insertable via parent invoice permission"
  on line_items for insert
  with check (
    exists (
      select 1 from invoices
      where invoices.id = line_items.invoice_id
      and current_role_in_org(invoices.organization_id) in ('ADMIN', 'OPERATOR')
    )
  );

-- activity_log: insertable by any org member. Fine-grained "who is allowed
-- to log which action" is already enforced by the application layer and by
-- transition_invoice() for status changes — this policy only guards against
-- someone with no relationship to the org writing fabricated audit rows.
create policy "activity insertable by org members"
  on activity_log for insert
  with check (current_role_in_org(organization_id) is not null);
