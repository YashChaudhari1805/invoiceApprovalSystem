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

`0005_no_self_membership_changes.sql` adds a policy (mirrored by an app-layer check in `routes/members.ts`) blocking an Admin from changing or removing their *own* membership row. Without it, an Admin could accidentally self-demote or self-remove and potentially leave an organization with zero Admins.

### `invoices`
The core business object.

- `taxable_amount`, `tax_amount`, `total_amount` are always **recomputed server-side** from `line_items` — treat any value arriving from the client for these as untrusted.
- `version` (integer, starts at 1) is the optimistic-locking counter — see "Invoice editing is atomic" below. It is bumped only by a trigger; clients can't set it.
- `created_by` is the "maker"; `approved_by` is the "checker." The `creator_not_approver` CHECK constraint is a database-level backstop for the maker-checker rule, in addition to the application-level check in `transition_invoice()` — belt and suspenders, since this is one of the rules the assignment specifically calls out as needing backend enforcement.
- Unique constraint: `(organization_id, vendor, invoice_number)` — this single constraint is what makes duplicate-invoice protection safe under concurrent requests. Two simultaneous inserts for the same combination will race at the database level and Postgres guarantees exactly one wins, regardless of what the application code checked beforehand.
- `status` moves through the workflow via the `transition_invoice()` function (see below) rather than a direct `UPDATE`, so the transition rules can't be bypassed by writing to the table directly. This isn't just a convention: `0004_invoice_edit_permissions.sql` revokes `UPDATE` on the `status` column from the `authenticated` role entirely at the Postgres privilege level, so even a hand-crafted request straight from a browser dev console can't move status outside the whitelist — only `transition_invoice()` can, since it runs as `SECURITY DEFINER`.

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

`transition_invoice()` encodes the status-transition whitelist and the maker-checker check once, as a `SECURITY DEFINER` function. Both the Fastify API and (if you ever add it) a direct Supabase client call from the frontend go through the same function, so there's exactly one place these rules can be wrong — instead of having to keep an app-layer check and a database-layer check in sync by hand. `transition_invoice()` takes a row lock (`SELECT ... FOR UPDATE`) on the invoice first, so two simultaneous transitions (e.g. Approve vs Reject) are serialized and only one can win — see `0006_transition_row_lock.sql`. Listing and viewing are ordinary RLS-protected `SELECT`s.

**Invoice creation is atomic.** `create_invoice()` (`0007_atomic_create_invoice.sql`) is the single entry point for creating an invoice. In one transaction it checks the caller is an Admin/Operator of the org, validates the line items and computes the totals itself (via the internal helper `compute_invoice_totals()` — exact decimal arithmetic, rounded half-up per line; the API never supplies totals), then inserts the invoice, its line items and the `INVOICE_CREATED` activity entry. If any step fails, everything is rolled back, so an invoice can never exist without its line items and audit entry. Errors use SQLSTATEs the API maps to HTTP codes: `42501` → 403, `22023`/`22003` → 400, `23505` (duplicate vendor + number) → 409.

**Invoice editing is atomic and uses optimistic locking.** `invoices.version` starts at 1 and is incremented by a trigger on every UPDATE (edits *and* status transitions), so no code path can forget. `update_invoice()` (`0008_atomic_edit_and_optimistic_locking.sql`) takes the version the client originally loaded and, in one transaction: locks the invoice row, checks the caller's permission, rejects the edit if the version has moved on (`PT409` → HTTP 409, code `VERSION_CONFLICT`, "This invoice was changed by another user. Refresh before saving again."), updates the header, replaces the line items, recomputes the totals and logs `INVOICE_EDITED`. If any step fails, everything rolls back and the previous invoice is untouched. The PATCH body must include `version`. Other error codes: `P0002` → 404, `42501` → 403, `22023`/`22007`/`22008`/`22003` → 400, `23505` → 409 (`DUPLICATE_INVOICE`).

**Direct writes are locked down (0009_lockdown_and_audit.sql).** `authenticated` no longer has any table/column privilege to INSERT into `activity_log`, UPDATE any column of `invoices` (not just totals — the whole header, since edits go through `update_invoice()` now), or INSERT/UPDATE/DELETE `line_items` directly. All of that is now reachable only through the SECURITY DEFINER functions, which are unaffected by these revokes because they run as the function owner. Member management (`add_org_member()`, `update_member_role()`, `remove_org_member()`) follows the same pattern: the membership write and its `MEMBER_ADDED`/`MEMBER_ROLE_CHANGED`/`MEMBER_REMOVED` activity entry happen in one transaction, and the by-email lookup for adding a member happens inside the function (bypassing the "profiles visible within shared orgs" RLS policy, since the target isn't a member yet), so the API no longer needs the service-role client for this at all. `transition_invoice()` now also records the old status, not just the new one (`{"from": ..., "to": ...}`), and `update_invoice()` records which fields were part of the edit (`{"changedFields": [...]}`). A test-only function, `test_create_invoice_with_broken_audit()`, lets the integration suite prove the audit insert and the business write share a transaction; it's restricted to `service_role`, which the running API never uses, and its failure is scoped to its own transaction (via a transaction-local `set_config`) so it's safe to run alongside other tests hitting the same database concurrently.

**Numeric and text validation is enforced at three layers (section 8, "defense in depth")** — the browser (`apps/web/src/components/line-items-editor.tsx`), the API (`apps/api/src/modules/invoices/schemas.ts`, zod), and the database (`compute_invoice_totals()` procedurally since 0007, plus CHECK constraints since `0010_numeric_and_length_constraints.sql`). The rule, the same at all three:
| Field | Rule |
|---|---|
| `quantity` | greater than 0 |
| `rate` | 0 or greater (0 is allowed — e.g. a free sample line) |
| `tax_rate` | 0 to 100 inclusive |
| `vendor` | 1-255 characters |
| `invoice_number` | 1-100 characters |
| line item `description` | 1-500 characters |

The browser copy previously required `rate > 0`, stricter than the API and database (which both allow 0) — an inconsistency in the opposite direction from the reported "browser allowed quantity 0" bug. It also didn't check `tax_rate` at all client-side. Both are fixed as of `0010`.

**Business rule: editing a Rejected invoice.** Admins can still edit an invoice in any status, including Approved or Rejected (e.g. to correct a mistake before resubmitting) — this was already true of the pre-existing RLS policy and is carried over unchanged into `update_invoice()`. Operators can only edit while a invoice is Draft or Review; once it's Approved or Rejected, only an Admin can touch it. Reviewers and Viewers can never edit.

**Business rule: future-dated invoices.** `invoice_date` has no upper or lower bound beyond being a valid date — a future-dated invoice (e.g. dated for an upcoming billing period) is allowed, since nothing in the assignment or the vendor-invoice domain suggests every invoice must be dated in the past. This is a decision documented here per section 12's checklist item, not a change in behavior.

## Local setup

```bash
supabase init
supabase start          # local Postgres + Auth + Studio
supabase db reset       # applies migrations/0001_init.sql fresh
```

Or against a hosted Supabase project: `supabase link --project-ref <ref>` then `supabase db push`.

Seed data: create users through Supabase Auth (dashboard, or `supabase.auth.admin.createUser` in a seed script) rather than inserting into `profiles` directly, since `profiles` rows are only created by the `on_auth_user_created` trigger firing off a real `auth.users` insert.
