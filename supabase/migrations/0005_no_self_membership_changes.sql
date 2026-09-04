-- Fixes: nothing stopped an Admin from changing or deleting their OWN
-- membership row via a direct request (self-promote, self-demote, or
-- self-remove — potentially leaving an org with zero Admins). The app layer
-- now checks this explicitly; this migration adds the same guarantee at the
-- database level, consistent with how every other hard rule in this app
-- (maker-checker, status transitions) is enforced in more than one place.

drop policy "memberships manageable by admins" on memberships;

-- Admins can insert/update/delete OTHER people's memberships freely.
create policy "memberships manageable by admins for other users"
  on memberships for all
  using (current_role_in_org(organization_id) = 'ADMIN' and user_id <> auth.uid())
  with check (current_role_in_org(organization_id) = 'ADMIN' and user_id <> auth.uid());

-- Every member (including an Admin) can still read their own membership row
-- — needed for the app to resolve "what's my role here" — this was already
-- covered by "memberships visible to org members" for SELECT, so this
-- change only affects INSERT/UPDATE/DELETE, not visibility.
