# Database schema

Migration source of truth: `supabase/migrations/0001_init.sql`. This doc explains what each table is for and how they connect — read it alongside the SQL, not instead of it.

## What changes by moving to Supabase

- **`auth.users` is managed by Supabase Auth** — you don't create it and can't add columns to it. Login, signup, password reset, and JWT issuance are handled for you (email/password is enough here; no need to build any of that by hand).
- **`profiles` is your shadow table** — a 1:1 row per `auth.users` row, auto-created by a trigger on signup, holding the app-facing fields (`name`). Every other table's foreign keys point to `profiles.id`, not `auth.users.id` directly, so your application code never has to reach into the `auth` schema.
- **Row Level Security (RLS) is a second enforcement layer.** Your Fastify API still does its own permission checks (keep those — the assignment explicitly wants backend-enforced authorization, and RLS alone doesn't replace input validation or business logic). RLS means that even if a bug or a future direct-from-frontend Supabase call bypassed the API entirely, Postgres itself would still refuse to return or write rows across tenant boundaries.

## Tables

### `profiles`
Display identity for a user. One row per `auth.users` row, kept in sync via the `on_auth_user_created` trigger. Referenced by every other table that needs to record "which user did this."

### `organizations`
One row per tenant — ABC Steel, XYZ Metals, etc. Every tenant-scoped table below carries an `organization_id` back to this table.

### `memberships`
**The multi-tenancy and RBAC backbone.** A user has zero access to an organization unless a row exists here, and the `role` column is scoped per-membership — so the same user can be `ADMIN` in one org and `VIEWER` in another with a single account. Every authorization decision, in both the Fastify middleware and the RLS policies, ultimately comes down to "does a membership row exist for `(auth.uid(), org_id)`, and what role does it carry."

Unique constraint: `(user_id, organization_id)` — one role per user per org, so changing someone's role is an `UPDATE`, not a delete-and-recreate.

### `invoices`
The core business object.

- `taxable_amount`, `tax_amount`, `total_amount` are always **recomputed server-side** from `line_items` — treat any value arriving from the client for these as untrusted.
- `created_by` is the "maker"; `approved_by` is the "checker." The `creator_not_approver` CHECK constraint is a database-level backstop for the maker-checker rule, in addition to the application-level check in `transition_invoice()` — belt and suspenders, since this is one of the rules the assignment specifically calls out as needing backend enforcement.
- Unique constraint: `(organization_id, vendor, invoice_number)` — this single constraint is what makes duplicate-invoice protection safe under concurrent requests. Two simultaneous inserts for the same combination will race at the database level and Postgres guarantees exactly one wins, regardless of what the application code checked beforehand.
- `status` moves through the workflow via the `transition_invoice()` function (see below) rather than a direct `UPDATE`, so the transition rules can't be bypassed by writing to the table directly.

### `line_items`
Multiple rows per invoice — description, quantity, rate, tax rate, and a server-computed `amount`. Deleting an invoice cascades to its line items.

### `activity_log`
Append-only audit trail. `invoice_id` is nullable so org-level events (like a role change, which isn't tied to any invoice) can still be logged. Every write to this table happens through backend service code or the `transition_invoice()` function — never a direct client insert of an arbitrary row, which would let someone forge audit history.

## Relationships at a glance

```
auth.users (Supabase-managed)
    │ 1:1
    ▼
profiles ──────────────┐
    │ 1:N                │ 1:N (created_by / approved_by / actor_id)
    ▼                    │
memberships              │
    │ N:1                │
    ▼                    │
organizations ──1:N──▶ invoices ──1:N──▶ line_items
    │                     │
    └──────1:N──────▶ activity_log ◀──────┘
```

## Why business logic lives in a Postgres function, not just app code

`transition_invoice()` encodes the status-transition whitelist and the maker-checker check once, as a `SECURITY DEFINER` function. Both the Fastify API and (if you ever add it) a direct Supabase client call from the frontend go through the same function, so there's exactly one place these rules can be wrong — instead of having to keep an app-layer check and a database-layer check in sync by hand. Simpler CRUD (create, list, view) is handled by ordinary RLS-protected `SELECT`/`INSERT`, since those don't have enough conditional logic to justify a function.

## Local setup

```bash
supabase init
supabase start          # local Postgres + Auth + Studio
supabase db reset       # applies migrations/0001_init.sql fresh
```

Or against a hosted Supabase project: `supabase link --project-ref <ref>` then `supabase db push`.

Seed data: create users through Supabase Auth (dashboard, or `supabase.auth.admin.createUser` in a seed script) rather than inserting into `profiles` directly, since `profiles` rows are only created by the `on_auth_user_created` trigger firing off a real `auth.users` insert.
