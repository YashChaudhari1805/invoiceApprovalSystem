-- =============================================================================
-- Section 10: idempotency for invoice creation
--
-- Idempotency key vs. the (organization_id, vendor, invoice_number) unique
-- constraint — these solve two different problems:
--
--   The UNIQUE CONSTRAINT stops two DIFFERENT logical requests from ever
--   producing two invoice records that share the same vendor + number. It's
--   a rule about the DATA: "Tata Metals invoice #123" can only exist once,
--   no matter who's asking or why. When it fires on a genuine retry, the
--   retry gets a 409 "already exists" error — which is confusing, because
--   from the user's point of view they didn't make a mistake, their earlier
--   attempt just succeeded without them finding out (e.g. the connection
--   dropped after the server committed but before the response arrived;
--   apps/web/src/lib/api.ts's own 8-second client timeout, added for the
--   free-tier cold-start problem, is exactly the kind of thing that
--   produces this: the server can still be mid-request, succeed a moment
--   later, and the client never sees it).
--
--   The IDEMPOTENCY KEY stops the SAME logical REQUEST, retried, from being
--   treated as a new request at all. It's identified by a value the CLIENT
--   generates once per attempt and resends unchanged on every retry of that
--   attempt — not by the invoice's business data. A retry with the same key
--   and the same payload gets back the EXACT ORIGINAL response (a 201 with
--   the invoice that was actually created, not a 409), and no second
--   invoice is created. A different key always starts a genuinely new
--   request, even with identical business data (so intentionally creating
--   two invoices for the same vendor+number... isn't possible anyway,
--   that's still the unique constraint's job — the two mechanisms are
--   complementary, not overlapping).
-- =============================================================================

create table idempotency_keys (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  -- Scoped by operation so the same key string can't accidentally collide
  -- across different kinds of write if this is ever extended past invoice
  -- creation (section 10 only asks for "invoice creation or another
  -- important write operation" — this schema supports adding more without
  -- a migration).
  operation        text not null,
  idempotency_key  text not null,
  -- A hash of the request's actual content. If the same key arrives again
  -- with DIFFERENT content, that's a client bug (key reuse across two
  -- genuinely different requests), not a retry — see create_invoice()'s
  -- handling below. Storing a hash rather than the raw request avoids
  -- keeping a second, easy-to-drift copy of the input around.
  request_hash     text not null,
  actor_id         uuid not null references profiles(id),
  -- The exact response returned to a matching retry, so a retry is
  -- indistinguishable from the original call's result.
  response         jsonb not null,
  created_at       timestamptz not null default now(),
  unique (organization_id, operation, idempotency_key)
);

comment on table idempotency_keys is
  'Tracks client-supplied idempotency keys for write operations, so a retried request returns the original result instead of repeating the action. See the comment above the table definition in 0012_idempotency.sql for how this differs from ordinary unique constraints.';

-- No policies -> default deny for `authenticated`/`anon`, the same lockdown
-- philosophy as 0009: this table is only ever read or written from inside
-- create_invoice() (SECURITY DEFINER, bypasses RLS), never directly.
alter table idempotency_keys enable row level security;

create index idempotency_keys_lookup on idempotency_keys (organization_id, operation, idempotency_key);

-- -----------------------------------------------------------------------------
-- create_invoice(), extended with an optional idempotency key.
--
-- Concurrency: two requests racing with the SAME key (e.g. a client firing
-- a retry a moment before the original's response arrives) are serialized
-- with a transaction-scoped advisory lock keyed on
-- (organization_id, operation, idempotency_key), taken before either the
-- cache is checked or any work is done. The second call blocks until the
-- first commits (or rolls back), then either finds the first call's cached
-- response and returns it, or — if the first call failed validation and
-- rolled back before ever writing a cache row — proceeds exactly as if it
-- were the first attempt. This is the same "lock, then check, then act"
-- shape as the row lock in transition_invoice() (0006), applied to a key
-- that doesn't have a row to lock yet on a brand-new key.
-- -----------------------------------------------------------------------------
-- Adding a parameter changes create_invoice()'s signature, and Postgres
-- identifies a function by (name, argument types) — CREATE OR REPLACE with
-- a new argument list creates an ADDITIONAL overload alongside the old
-- 5-argument version, rather than replacing it. Left as two overloads, a
-- call that omits the idempotency key could resolve ambiguously (or to the
-- stale version with none of this migration's behavior). Drop the old
-- signature explicitly first so there is exactly one create_invoice().
drop function if exists create_invoice(uuid, text, text, date, jsonb);

create or replace function create_invoice(
  p_organization_id uuid,
  p_vendor text,
  p_invoice_number text,
  p_invoice_date date,
  p_line_items jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role role;
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

  if p_vendor is null or char_length(p_vendor) not between 1 and 255 then
    raise exception 'Vendor is required (1-255 characters)' using errcode = '22023';
  end if;
  if p_invoice_number is null or char_length(p_invoice_number) not between 1 and 100 then
    raise exception 'Invoice number is required (1-100 characters)' using errcode = '22023';
  end if;
  if p_invoice_date is null then
    raise exception 'Invoice date is required' using errcode = '22023';
  end if;
  if p_idempotency_key is not null and char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'Idempotency key must be 1-200 characters' using errcode = '22023';
  end if;

  v_calc := compute_invoice_totals(p_line_items); -- validates + computes totals

  if p_idempotency_key is not null then
    -- hashtextextended(text, seed) -> bigint, exactly what pg_advisory_xact_lock
    -- wants; folds the three-part key into one lock id. Released
    -- automatically when this transaction ends (commit or rollback) — no
    -- explicit unlock needed, and it can't be left stuck by a crashed call.
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
      return v_cached_response; -- genuine retry: same key, same payload -> hand back the original result, create nothing
    end if;
  end if;

  insert into invoices (
    organization_id, vendor, invoice_number, invoice_date,
    taxable_amount, tax_amount, total_amount, created_by
  ) values (
    p_organization_id, p_vendor, p_invoice_number, p_invoice_date,
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

revoke all on function create_invoice(uuid, text, text, date, jsonb, text) from public, anon;
grant execute on function create_invoice(uuid, text, text, date, jsonb, text) to authenticated;
