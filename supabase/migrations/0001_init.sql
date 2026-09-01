-- =============================================================================
-- Multi-Tenant Invoice Approval System — initial schema
-- Target: Supabase Postgres
-- =============================================================================

create extension if not exists "pgcrypto";

create type role as enum ('ADMIN', 'OPERATOR', 'REVIEWER', 'VIEWER');
create type invoice_status as enum ('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED');
create type activity_action as enum (
  'INVOICE_CREATED', 'INVOICE_EDITED', 'INVOICE_SUBMITTED',
  'INVOICE_APPROVED', 'INVOICE_REJECTED',
  'MEMBER_ADDED', 'MEMBER_REMOVED', 'MEMBER_ROLE_CHANGED'
);

-- -----------------------------------------------------------------------------
-- profiles
-- Supabase Auth owns auth.users (email, password hash, session tokens) and you
-- cannot add arbitrary columns to it. `profiles` is a 1:1 shadow table for the
-- app-facing fields (display name) and is what every other table's foreign
-- keys point to, so app logic never has to reach into the auth schema.
-- Row is created automatically by the trigger below whenever a user signs up.
-- -----------------------------------------------------------------------------
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  name       text not null,
  created_at timestamptz not null default now()
);

create function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- -----------------------------------------------------------------------------
-- organizations
-- One row per tenant (ABC Steel, XYZ Metals, ...). Everything else that is
-- tenant-scoped carries an organization_id foreign key back to this table.
-- -----------------------------------------------------------------------------
create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- memberships
-- The multi-tenancy + RBAC backbone. A user has NO access to an organization
-- unless a row exists here, and their role is scoped per-organization — this
-- is what lets Rahul be Admin at ABC Steel and Viewer at XYZ Metals with the
-- same account. Every authorization check, in the app layer and in RLS below,
-- ultimately reduces to "does a membership row exist, and what role does it say".
-- -----------------------------------------------------------------------------
create table memberships (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  role            role not null,
  created_at      timestamptz not null default now(),
  unique (user_id, organization_id) -- one role per user per org
);

create index idx_memberships_org on memberships(organization_id);
create index idx_memberships_user on memberships(user_id);

-- -----------------------------------------------------------------------------
-- invoices
-- The core business object. taxable_amount / tax_amount / total_amount are
-- always recomputed server-side from line_items — never trust these if they
-- ever arrive from the client directly.
-- created_by is the "maker"; approved_by is the "checker" — the app layer
-- enforces created_by <> approved_by, and it's worth adding as a CHECK too
-- (see constraint below) as a database-level backstop.
-- -----------------------------------------------------------------------------
create table invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vendor          text not null,
  invoice_number  text not null,
  invoice_date    date not null,
  status          invoice_status not null default 'DRAFT',

  taxable_amount numeric(14,2) not null,
  tax_amount     numeric(14,2) not null,
  total_amount   numeric(14,2) not null,

  created_by  uuid not null references profiles(id),
  approved_by uuid references profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The single constraint that makes duplicate-invoice protection
  -- race-condition-safe: two simultaneous inserts for the same
  -- (org, vendor, invoice_number) can't both succeed, full stop,
  -- regardless of what the application code does or doesn't check first.
  unique (organization_id, vendor, invoice_number),

  -- Database-level backstop for maker-checker, in addition to the
  -- application-level check. Cheap insurance against a future code path
  -- that forgets to check it.
  constraint creator_not_approver check (approved_by is null or approved_by <> created_by)
);

create index idx_invoices_org_status on invoices(organization_id, status);
create index idx_invoices_org_vendor on invoices(organization_id, vendor);

create function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger invoices_set_updated_at
  before update on invoices
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- line_items
-- Multiple rows per invoice. `amount` is server-computed (quantity * rate,
-- plus tax) — never accepted verbatim from the client.
-- -----------------------------------------------------------------------------
create table line_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  description text not null,
  quantity    numeric(12,2) not null,
  rate        numeric(12,2) not null,
  tax_rate    numeric(5,2) not null,
  amount      numeric(14,2) not null
);

create index idx_line_items_invoice on line_items(invoice_id);

-- -----------------------------------------------------------------------------
-- activity_log
-- Append-only audit trail. invoice_id is nullable so org-level events (e.g. a
-- role change) can be logged without inventing a fake invoice reference.
-- -----------------------------------------------------------------------------
create table activity_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id      uuid references invoices(id) on delete set null,
  actor_id        uuid not null references profiles(id),
  action          activity_action not null,
  metadata        jsonb, -- e.g. {"from": "REVIEW", "to": "APPROVED"}
  created_at      timestamptz not null default now()
);

create index idx_activity_org_created on activity_log(organization_id, created_at desc);
create index idx_activity_invoice on activity_log(invoice_id);

-- =============================================================================
-- Row Level Security
-- These policies are a second, database-enforced line of defense on top of
-- the Fastify middleware — even a fully compromised or buggy API layer still
-- can't cross tenant boundaries, because Postgres itself refuses the row.
-- All policies key off memberships for the CURRENT auth.uid(), never off a
-- client-supplied org id or role claim.
-- =============================================================================

alter table profiles enable row level security;
alter table organizations enable row level security;
alter table memberships enable row level security;
alter table invoices enable row level security;
alter table line_items enable row level security;
alter table activity_log enable row level security;

-- Helper: does the current user have a membership in this org, and what role?
create function current_role_in_org(org_id uuid)
returns role as $$
  select role from memberships
  where organization_id = org_id and user_id = auth.uid();
$$ language sql stable security definer;

-- profiles: visible to yourself, and to anyone who shares an org with you
-- (needed to render member names on the org members screen / activity log)
create policy "profiles visible within shared orgs"
  on profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from memberships m1
      join memberships m2 on m1.organization_id = m2.organization_id
      where m1.user_id = auth.uid() and m2.user_id = profiles.id
    )
  );

-- organizations: visible only if you have a membership
create policy "orgs visible to members"
  on organizations for select
  using (current_role_in_org(id) is not null);

-- memberships: visible to anyone in the same org; only Admins can write
create policy "memberships visible to org members"
  on memberships for select
  using (current_role_in_org(organization_id) is not null);

create policy "memberships manageable by admins"
  on memberships for all
  using (current_role_in_org(organization_id) = 'ADMIN')
  with check (current_role_in_org(organization_id) = 'ADMIN');

-- invoices: visible to any org member; insert requires Admin/Operator;
-- update is intentionally left to the SECURITY DEFINER function below
-- rather than a row policy, because the maker-checker + status-transition
-- rules are too conditional to express safely as a single USING clause.
create policy "invoices visible to org members"
  on invoices for select
  using (current_role_in_org(organization_id) is not null);

create policy "invoices insertable by admin or operator"
  on invoices for insert
  with check (current_role_in_org(organization_id) in ('ADMIN', 'OPERATOR'));

-- line_items: inherit visibility from the parent invoice
create policy "line items visible via parent invoice"
  on line_items for select
  using (
    exists (
      select 1 from invoices
      where invoices.id = line_items.invoice_id
      and current_role_in_org(invoices.organization_id) is not null
    )
  );

-- activity_log: visible to org members, insert-only (append-only audit trail),
-- writes happen exclusively through backend service functions, never direct
-- client inserts of arbitrary rows
create policy "activity visible to org members"
  on activity_log for select
  using (current_role_in_org(organization_id) is not null);

-- =============================================================================
-- Status transition + maker-checker as a database function
-- Called via RPC (or from the Fastify API using the same connection) so the
-- transition whitelist and the "creator can't approve their own invoice" rule
-- live in exactly one place, enforced no matter which layer calls it.
-- =============================================================================
create function transition_invoice(
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

  -- Explicit transition whitelist
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
    case p_to_status
      when 'APPROVED' then 'INVOICE_APPROVED'
      when 'REJECTED' then 'INVOICE_REJECTED'
      else 'INVOICE_SUBMITTED'
    end,
    jsonb_build_object('to', p_to_status)
  );

  return v_invoice;
end;
$$ language plpgsql security definer;
