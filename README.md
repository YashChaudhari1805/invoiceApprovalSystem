# Multi-Tenant Invoice Approval System

A working multi-tenant web application for creating, reviewing, and approving purchase invoices, with role-based permissions, a maker-checker approval rule, and full audit history.

**Live demo:**
- Frontend: `https://invoice-approval-system-demo.vercel.app/login` 
- API: `https://invoiceapprovalsystem.onrender.com` (free tier — the first request after a period of inactivity may take 30-60s to wake up)

## Tech stack

- **Frontend:** Next.js 14 (App Router) + React + TypeScript + Tailwind CSS
- **Backend:** Node.js + Fastify + TypeScript
- **Database & Auth:** Supabase (PostgreSQL + Row Level Security + Supabase Auth)

This is a Node/TypeScript project, so dependencies are pinned via `package.json` + `package-lock.json` (at the repo root and in each workspace) rather than a `requirements.txt` — that file is a Python convention and doesn't apply here. `npm install` from the repo root installs everything for both workspaces via npm workspaces.

## Architecture at a glance

Every org-scoped request passes through, in order: **authenticate** (verifies the Supabase-issued JWT locally against Supabase's public JWKS keys, no network round trip) -> **requireMembership** (re-derives the caller's role fresh from the database on every request, scoped by RLS) -> **requirePermission** (checks role against a static permission table) -> route-specific business logic (maker-checker, status transitions, etc.).

Row Level Security policies in Postgres are a second, independent enforcement layer underneath the API: they stop a signed-in user reading or changing *another organisation's* data even if the Fastify layer has a bug. See `SCHEMA.md` for the full data model and exactly which direct writes are locked down. The database does **not yet** enforce every rule on its own -- see "Known limitations" below.

### Why the SECURITY DEFINER functions are safe to expose

All of the database's business-logic functions (`create_invoice`, `update_invoice`, `transition_invoice`, `add_org_member`, `update_member_role`, `remove_org_member`) are `SECURITY DEFINER`: they run with the privileges of the function owner, not the calling user, which is what lets a normal `authenticated` user -- who has no direct privilege to update invoices, change line items or write audit entries (see "Direct writes are locked down" in `SCHEMA.md`; direct invoice *creation* and membership changes are not yet locked down -- see "Known limitations") -- create an invoice or add a member. That extra power is exactly why each one is written narrowly and reviewed against a short checklist:

1. **Every one of them re-derives the caller's identity and permissions from scratch**, using `auth.uid()` and `current_role_in_org()` -- never a client-supplied user id or role. A caller cannot claim to be someone else or claim a role they don't hold; the function looks it up itself, on every call.
2. **Every one of them pins an explicit `search_path`** (`set search_path = public`, added for the two pre-existing functions that lacked it in `0011_security_definer_hardening.sql`). Without this, a `SECURITY DEFINER` function resolves unqualified names using the *caller's* session state, and Postgres always checks a session's temporary schema first regardless of `search_path` -- so any authenticated user could otherwise create a same-named temporary table (e.g. a fake `memberships`) and have a privileged function silently read from or write to it instead of the real table. Pinning `search_path` closes that.
3. **Every one of them does exactly one narrowly-scoped business operation** -- create an invoice, edit an invoice, transition an invoice's status, or manage one membership -- and nothing else. None of them accept a table name, column name, or arbitrary SQL from the caller; every input is a plain scalar or a `jsonb` payload whose shape is validated inside the function before it touches a table (see `compute_invoice_totals()`'s validation, reused by both `create_invoice` and `update_invoice`).
4. **Every write they make is inside their own transaction**, including the matching `activity_log` entry (see "Make audit history reliable" in `SCHEMA.md`) -- so exposing them doesn't create a way to make a change without a corresponding audit trail.
5. **The two test-only functions** (`test_create_invoice_with_broken_audit`, and the always-installed-but-inert `test_activity_log_boom` trigger it drives) are `revoke`d from `public`/`anon`/`authenticated` and only `grant`ed to `service_role` -- a privilege level the running API never uses (it always calls Postgres as `authenticated`, via the caller's own JWT; see `apps/api/src/plugins/auth.ts`) and which is never issued to a browser. They exist purely so the integration suite can prove certain rollback behavior against a real database.

Everything else (`compute_invoice_totals`, `bump_invoice_version`, `set_updated_at`) is a plain helper or trigger function, not `SECURITY DEFINER`, and runs with the calling role's own (already-checked) privileges.

## Setup

### 1. Create a Supabase project

At [supabase.com](https://supabase.com), create a new project. Note your project reference, database password, and (from Project Settings > API) your Project URL, anon key, and service role key.

### 2. Apply the database schema

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

This runs every migration in `supabase/migrations/` -- tables, RLS policies, and the `transition_invoice()` function.

### 3. Configure environment variables

Copy `.env.example` to `.env` in the repo root and fill in your Supabase values (used by the API and the seed/cleanup scripts):

```bash
cp .env.example .env
```

Then copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the same Supabase URL/anon key, plus `API_URL` pointing at your locally-running API (`http://localhost:4000` by default):

```bash
cp apps/web/.env.example apps/web/.env.local
```

### 4. Install dependencies and seed data

```bash
npm install
npm run seed
```

This creates six real Supabase Auth users (`rahul@example.com`, `yash@example.com`, `neha@example.com`, `arjun@example.com`, `meera@example.com`, `karan@example.com` — all password `password123`), six organizations (ABC Steel, XYZ Metals, Yash Textiles, Coastal Logistics, Meera Exports, Sunrise Traders), four sample invoices in ABC Steel (one per status) and 24 sample invoices in Yash Textiles (6 per status: Draft, Review, Approved, Rejected). Rahul is Admin at ABC Steel and Viewer at XYZ Metals and Sunrise Traders; Yash is Reviewer at ABC Steel and Admin at Yash Textiles, where Neha is the Reviewer who approves/rejects his invoices (maker-checker). This means the app has real data to look at immediately after seeding, rather than starting from empty screens.

New users can also self-register at `/signup` (Supabase Auth email/password) — an Admin then adds them to an org by email from the Members screen. **If you want a self-registered account to be usable immediately** (no confirmation email), turn off "Confirm email" in your Supabase project under Authentication → Sign In / Providers → Email. This is off by default on a fresh project in some Supabase versions and on in others, so it's worth checking before a live demo — Supabase's own email sending has a low rate limit on the free tier, so relying on it during a demo is risky.

### 5. Run it

Two terminals:

```bash
npm run dev:api    # Fastify API on http://localhost:4000
npm run dev:web    # Next.js frontend on http://localhost:3000
```

Visit `http://localhost:3000`, log in as either seeded user.

## Testing

```bash
npm run typecheck          # API (source + tests) and web
npm run lint               # non-interactive; no prompts
npm run test:unit          # pure business-rule tests: no database, no env vars needed
npm run test:integration   # real database; see below
npm run build              # API and web production builds
```

### Running the integration tests

The integration suite signs in as real users against a **real Supabase database** and, through the service-role key, creates and deletes rows. Run it against a **dedicated test project (or a local Supabase), never a project that holds real data.**

1. Create a separate Supabase project for testing and apply the migrations (`supabase link --project-ref <test-ref>` then `supabase db push`).
2. Create **`.env.test`** in the repo root (it is gitignored; see `.env.example`):

| Variable | Needed by | Meaning |
|---|---|---|
| `SUPABASE_URL` | API, tests, seed | Project URL |
| `SUPABASE_ANON_KEY` | API, tests | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | tests, seed only | Bypasses RLS -- never put it in the web app or any browser-visible place |
| `ALLOW_REMOTE_TEST_DB` | tests | Set to `1` to confirm a *hosted* project really is a throwaway test project (not needed for `localhost`) |
| `FRONTEND_URL`, `PORT` | API at runtime (optional) | Allowed web origin for CORS; API port (default 4000) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `API_URL` | web | In `apps/web/.env.local` |

   When `.env.test` exists the tests read **only** that file and ignore `.env`, so a missing value can never fall back to your real project's keys.
3. Seed the demo users and organisations (safe to run repeatedly) with **`npm run seed:test`**. It reads `.env.test` and prints the project it is seeding before doing anything -- check that it is your TEST project. (Plain `npm run seed` reads `.env`, i.e. your normal project.)
4. `npm run test:integration`

If a variable is missing, or the URL is a hosted project without `ALLOW_REMOTE_TEST_DB=1`, the suite stops immediately with an explanation instead of touching anything. Tests that create data use disposable per-file organisations (`apps/api/test/helpers/test-org.ts`), so the seed data is not polluted. Seed users share the password `password123`, another reason never to point any of this at production.

### Continuous integration

`.github/workflows/ci.yml` runs typecheck, lint, unit tests and both builds on every push and pull request. The integration job runs only when `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY` and `TEST_SUPABASE_SERVICE_ROLE_KEY` are set as repository secrets (pointing at a test project); otherwise it reports "skipped".

## Manual QA

API-level tests cannot catch UI-only defects (the original search/vendor-filter bug was one). Before a release, click through the assignment's "important cases" in the real UI: another organisation's invoice URL, an Operator trying to approve, a Viewer trying to edit, a creator approving their own invoice, a duplicate create, and the search/filter/pagination controls at 320, 375, 390, 414 and 768px widths.

## Business rules

| Rule | Behaviour |
|---|---|
| Quantity / rate / tax rate | Quantity must be **greater than 0**; rate must not be negative; tax rate between 0 and 100 (browser, API and database `CHECK`; see `SCHEMA.md`) |
| Future-dated invoices | **Allowed.** No layer rejects an invoice date in the future |
| Who can edit | Operators: Draft or Review only. Admins: any status. Reviewers and Viewers: never |
| Rejected invoices | **Terminal** (no path back to Draft). Operators cannot edit them; Admins can -- rationale in `SCHEMA.md` ("Business rule: editing a Rejected invoice") |
| Approve / reject | Reviewers and Admins, never the invoice's creator, only while the invoice is in Review |
| Duplicates | Same organisation + vendor + invoice number is refused by a database unique constraint (case-sensitive, see below), so simultaneous requests are also safe |

## Design notes

- **Transactions.** `create_invoice` and `update_invoice` write the invoice, line items, totals and audit row in one database transaction; any failure rolls everything back, so an action cannot succeed without its history.
- **Race conditions.** `transition_invoice` locks the invoice row (`SELECT ... FOR UPDATE`): of two simultaneous Approve/Reject requests exactly one wins and the other is told the invoice is no longer in Review.
- **Optimistic locking.** `invoices.version` increments on every change; *edits* must send the version they loaded, otherwise the API answers 409.
- **Idempotency vs. the unique constraint.** The unique constraint stops two *different* requests creating the same business invoice. An `Idempotency-Key` makes *retrying the same request* safe: same key and payload returns the original result. See `SCHEMA.md`.
- **Stale pages.** Chosen approach: **revalidate on tab focus/visibility** (`RevalidateOnFocus`, throttled to once per 5 s), not polling or Supabase Realtime. It needs no persistent connection or extra infrastructure and covers the real scenario (returning to a tab that has gone stale). Limit: a tab left visible and idle does not update by itself.

## Known limitations

**Not yet enforced by the database itself** (the API enforces them, but a signed-in user who calls Supabase directly, bypassing the API, could get around them):

- **Direct invoice creation.** `INSERT` into `invoices` is still permitted by RLS for Admins/Operators, so a direct call could create an invoice with arbitrary status, totals and creator, bypassing `create_invoice()` and its audit entry. `UPDATE` of invoices and all writes to line items and the audit log *are* locked down. Planned fix: revoke direct `INSERT` so only the functions can create invoices.
- **Direct membership changes.** The Admin policy on `memberships` allows direct role changes/removals that skip `update_member_role()` and so are not audited. Same planned fix.
- **Approving what you saw.** Approve/reject do not check the invoice version, so a reviewer can approve an invoice that was edited after they opened it. Planned fix: require the viewed version on status changes (as edits already do).
- **Admins can edit Approved/Rejected invoices** (the assignment allows Admins to edit invoices; the audit trail records that an edit happened but not the old/new values).

**Smaller known issues**

- Duplicate detection is case- and whitespace-sensitive ("Tata Metals" and "tata metals" differ), and whitespace-only vendor/invoice-number values are not rejected.
- Every API call, including approve/reject, is aborted by the web app after 8 s. If the server is slow (e.g. a cold start) the user can be told an action failed when it may in fact have completed; refresh to see the true state.
- The default invoice date on the create form is computed in UTC, so early-morning users east of UTC can see yesterday's date pre-filled.
- `SECURITY DEFINER` functions pin `search_path = public`; strictly, `pg_temp` should also be listed last.
- The two test-only database objects (`test_create_invoice_with_broken_audit`, the inert `test_activity_log_boom` trigger) live in the production migrations, restricted to `service_role`. They should move to a test-only migration.
- Authentication is email/password via Supabase Auth, not OAuth/SSO.
- The free-tier API host (Render) sleeps when idle, so the first request after a quiet period can take 30-60 s.

**Dependencies.** `npm audit --omit=dev` reports **4 vulnerable packages**: 1 critical (`next`) and 3 high (`fastify`, `find-my-way`, `postcss`). Already done: Next upgraded from 14.2.5 to **14.2.35** (the latest release of the same 14.2 line, which resolved 12 of the 35 advisories listed against 14.2.5, including an authorization-bypass issue) and the non-breaking `fast-uri` fix applied. Everything still listed needs a **major** upgrade (Next 16, Fastify 5), which was deliberately not forced: `npm audit fix --force` would change several major versions at once and risk breaking the build. Planned as a separate, tested change. A plain `npm audit` reports more (about 12) because it also counts dev-only tooling (Vitest/Vite/esbuild, the ESLint config) that never ships to users.

## Project structure

```
apps/
  api/                  Fastify backend
    src/
      plugins/          auth (JWT verification), tenant (membership/RBAC)
      routes/           orgs, invoices, members
      lib/              pure business rules, Supabase client factories
    test/
      unit/             pure rule tests, no DB
      integration/      real-Supabase tests, RLS + API + RPC
      helpers/          disposable test-org factory
  web/                  Next.js frontend
    src/
      app/orgs/[orgId]/ org-scoped pages (invoices, members, activity) under a shared layout
      components/       shared UI (app shell, status badges, line-item editor, etc.)
      lib/supabase/      browser + server Supabase client factories
supabase/
  migrations/           schema, RLS policies, transition_invoice() -- source of truth for the DB
scripts/
  seed.ts               creates seed users + orgs
  cleanup-test-data.ts  purges any stray test-generated invoices from real orgs
```
