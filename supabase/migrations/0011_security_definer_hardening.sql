-- =============================================================================
-- Section 9: SECURITY DEFINER hardening
--
-- A SECURITY DEFINER function runs with the privileges of the function's
-- OWNER, not the caller — which is exactly what lets create_invoice(),
-- transition_invoice(), etc. write to tables the calling role (authenticated)
-- has no direct privilege on (see 0009). That extra power is also exactly
-- why these functions need extra care: if a SECURITY DEFINER function
-- doesn't pin its own search_path, it resolves unqualified names (tables,
-- functions, operators, types) using whatever search_path the CALLER's
-- session happens to have — and Postgres always looks in a session's
-- temporary schema before anything else, regardless of search_path. Anyone
-- who can run SQL as that caller (any authenticated user, here) can
-- therefore create a same-named temporary object — a fake `memberships`
-- table, say — and have it silently take over inside a privileged function
-- they don't otherwise have access to. Pinning search_path is the standard
-- fix (it's what Supabase's own database linter checks for under "Function
-- Search Path Mutable").
--
-- Two functions from 0001 predate this practice — introduced from 0007
-- onward for everything written since — and are fixed here:
--
--   current_role_in_org()  is the single most-used function in the system:
--   every RLS policy and every other SECURITY DEFINER function calls it to
--   answer "does this user belong to this org, and with what role". It's
--   also schema-qualified here (memberships -> public.memberships) as
--   belt-and-suspenders, on top of the search_path pin.
--
--   handle_new_user()  fires automatically on every signup (its trigger is
--   defined on auth.users, outside this migration) and inserts the new
--   profile row. Already referenced `public.profiles` with an explicit
--   schema, but still had no search_path pin, which — as above — a
--   qualified table reference alone does not fully substitute for.
--
-- Two more functions, not SECURITY DEFINER (so not the security risk this
-- section is about) but still worth a consistent, predictable search_path
-- for the same reason any production function should have one, are updated
-- too: set_updated_at() and bump_invoice_version(), both plain BEFORE
-- triggers.
--
-- Every other SECURITY DEFINER function already has an explicit
-- `set search_path = public` from when it was first written
-- (create_invoice, update_invoice, transition_invoice's 0006/0009 versions,
-- add_org_member, update_member_role, remove_org_member,
-- test_create_invoice_with_broken_audit) — nothing left to change there.
-- =============================================================================

create or replace function current_role_in_org(org_id uuid)
returns role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.memberships
  where organization_id = org_id and user_id = auth.uid();
$$;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$;

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function bump_invoice_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;
