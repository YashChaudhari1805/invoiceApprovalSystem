# Multi-Tenant Invoice Approval System

A working multi-tenant web application for creating, reviewing, and approving purchase invoices, with role-based permissions, a maker-checker approval rule, and full audit history.

**Live demo:**
- Frontend: `https://<your-vercel-app>.vercel.app` — **fill in your actual Vercel URL before submitting**
- API: `https://invoiceapprovalsystem.onrender.com` (free tier — the first request after a period of inactivity may take 30-60s to wake up)

## Tech stack

- **Frontend:** Next.js 14 (App Router) + React + TypeScript + Tailwind CSS
- **Backend:** Node.js + Fastify + TypeScript
- **Database & Auth:** Supabase (PostgreSQL + Row Level Security + Supabase Auth)

This is a Node/TypeScript project, so dependencies are pinned via `package.json` + `package-lock.json` (at the repo root and in each workspace) rather than a `requirements.txt` — that file is a Python convention and doesn't apply here. `npm install` from the repo root installs everything for both workspaces via npm workspaces.

## Architecture at a glance

Every org-scoped request passes through, in order: **authenticate** (verifies the Supabase-issued JWT locally against Supabase's public JWKS keys, no network round trip) -> **requireMembership** (re-derives the caller's role fresh from the database on every request, scoped by RLS) -> **requirePermission** (checks role against a static permission table) -> route-specific business logic (maker-checker, status transitions, etc.).

Row Level Security policies in Postgres are a second, independent enforcement layer underneath the API -- even a bug in the Fastify layer can't leak data across tenants or bypass maker-checker, because the database itself refuses those operations. See `SCHEMA.md` for the full data model and `PLAN.md` for the original architecture writeup.

### Why the SECURITY DEFINER functions are safe to expose

All of the database's business-logic functions (`create_invoice`, `update_invoice`, `transition_invoice`, `add_org_member`, `update_member_role`, `remove_org_member`) are `SECURITY DEFINER`: they run with the privileges of the function owner, not the calling user, which is what lets a normal `authenticated` user -- who has no direct table privilege to do so (see "Direct writes are locked down" in `SCHEMA.md`) -- create an invoice or add a member. That extra power is exactly why each one is written narrowly and reviewed against a short checklist:

1. **Every one of them re-derives the caller's identity and permissions from scratch**, using `auth.uid()` and `current_role_in_org()` -- never a client-supplied user id or role. A caller cannot claim to be someone else or claim a role they don't hold; the function looks it up itself, on every call.
2. **Every one of them pins an explicit `search_path` that lists `pg_temp` last** (`set search_path = public, pg_temp`; introduced in `0011_security_definer_hardening.sql` and applied to *every* `SECURITY DEFINER` function in `0013_review_round_1_hardening.sql`). Without a pinned path, a `SECURITY DEFINER` function resolves unqualified names using the *caller's* session state; and if `pg_temp` is not named explicitly, Postgres searches the session's temporary schema **first** -- so a caller who could create a same-named temporary table (e.g. a fake `memberships`) could have a privileged function read from or write to it instead of the real table. Naming `pg_temp` last closes that. (Plain `search_path = public` pins the schema but does *not* by itself demote the temp schema.)
3. **Every one of them does exactly one narrowly-scoped business operation** -- create an invoice, edit an invoice, transition an invoice's status, or manage one membership -- and nothing else. None of them accept a table name, column name, or arbitrary SQL from the caller; every input is a plain scalar or a `jsonb` payload whose shape is validated inside the function before it touches a table (see `compute_invoice_totals()`'s validation, reused by both `create_invoice` and `update_invoice`).
4. **Every write they make is inside their own transaction**, including the matching `activity_log` entry (see "Make audit history reliable" in `SCHEMA.md`) -- so exposing them doesn't create a way to make a change without a corresponding audit trail.
5. **Client roles cannot write tables at all.** `anon` and `authenticated` hold only `SELECT` on the business tables (`0013`); every write goes through the functions above. `TRUNCATE`/`DELETE`/direct `INSERT` are not granted, and `EXECUTE` on the functions is revoked from `anon`/`PUBLIC`. Default privileges are also revoked, so a *new* table is invisible to client roles until access is granted deliberately.
6. **The two test-only functions** (`test_create_invoice_with_broken_audit`, and the always-installed-but-inert `test_activity_log_boom` trigger it drives) are `revoke`d from `public`/`anon`/`authenticated` and only `grant`ed to `service_role` -- a privilege level the running API never uses (it always calls Postgres as `authenticated`, via the caller's own JWT; see `apps/api/src/plugins/auth.ts`) and which is never issued to a browser. They exist purely so the integration suite can prove certain rollback behavior against a real database.

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

The web app reads this same root `.env` (it needs no separate file). Optionally set `API_URL` if the API is not on `http://localhost:4000`. To override a value for the web app only, put it in `apps/web/.env.local`.


### 4. Install dependencies and seed data

```bash
npm install
npm run seed
```

This creates six real Supabase Auth users (`rahul@example.com`, `yash@example.com`, `neha@example.com`, `arjun@example.com`, `meera@example.com`, `karan@example.com` — all password `password123`), six organizations (ABC Steel, XYZ Metals, Yash Textiles, Coastal Logistics, Meera Exports, Sunrise Traders), four sample invoices in ABC Steel (one per status) and 24 sample invoices in Yash Textiles (6 per status: Draft, Review, Approved, Rejected). Rahul is Admin at ABC Steel and Viewer at XYZ Metals and Sunrise Traders; Yash is Reviewer at ABC Steel and Admin at Yash Textiles, where Neha is the Reviewer who approves/rejects his invoices (maker-checker). This means the app has real data to look at immediately after seeding, rather than starting from empty screens.

New users can also self-register at `/signup` (Supabase Auth email/password) — an Admin then adds them to an org by email from the Members screen. **If you want a self-registered account to be usable immediately** (no confirmation email), turn off "Confirm email" in your Supabase project under Authentication → Sign In / Providers → Email. This is off by default on a fresh project in some Supabase versions and on in others, so it's worth checking before a live demo — Supabase's own email sending has a low rate limit on the free tier, so relying on it during a demo is risky.

### 5. Run it

```bash
npm run dev        # builds the shared package, then starts API (:4000) and web (:3000) together
# or separately:
npm run dev:api
npm run dev:web
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

The integration suite signs in as real users against a **real Supabase database** and, through the service-role key, creates and deletes rows. It must therefore run against a **dedicated test project or a local Supabase -- never a project that holds real data.**

1. Create a separate Supabase project for testing (or run `supabase start` locally) and apply the migrations (`supabase db push`, or `supabase db reset` locally).
2. Copy `.env.example` to **`.env.test`** in the repo root and fill in the table below. When `.env.test` exists the tests read **only** that file and ignore `.env` completely, so a missing value can never fall back to your real project's keys:

| Variable | Needed by | Meaning |
|---|---|---|
| `SUPABASE_URL` | API, tests, seed | Project URL |
| `SUPABASE_ANON_KEY` | API, tests | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | tests, seed only | Bypasses RLS. Never put in the web app or any browser-visible place |
| `ALLOW_REMOTE_TEST_DB` | tests | Set to `1` to confirm a *hosted* project really is a throwaway test project. Not needed for `localhost` |
| `FRONTEND_URL` | API (runtime) | The web app's origin, for CORS. Unset in production = CORS disabled (fails closed) |
| `PORT` | API (runtime) | Defaults to 4000 |
| `API_URL` | web | Where the web app reaches the API |

3. Seed the demo users and organisations (safe to run repeatedly) with **`npm run seed:test`**. This reads `.env.test` and prints the project it is seeding before doing anything -- check that it is your TEST project. (Plain `npm run seed` reads `.env`, i.e. your normal project.)
4. `npm run test:integration`

If a required variable is missing, or the URL is a hosted project without `ALLOW_REMOTE_TEST_DB=1`, the suite stops immediately with an explanatory message instead of touching anything. Tests that create data use disposable per-file organisations (`apps/api/test/helpers/test-org.ts`) so the seed data is never polluted. Seed users share the password `password123` -- another reason these must never be pointed at production.

### Continuous integration

`.github/workflows/ci.yml` runs typecheck, lint, unit tests and both builds on every push and pull request. The integration job runs only when `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY` and `TEST_SUPABASE_SERVICE_ROLE_KEY` are configured as repository secrets (pointing at a test project); otherwise it reports "skipped".

## Manual QA

The API-level tests cannot catch UI-only defects (the original search/vendor-filter bug was one). Before a release, click through the "important cases" from the assignment as the real UI: another org's invoice URL, an Operator trying to approve, a Viewer trying to edit, a creator approving their own invoice, a duplicate create, and the filter/search/pagination controls at 320, 375, 390, 414 and 768px widths.

## Business rules (final)

| Rule | Behaviour |
|---|---|
| Quantity | Must be **greater than 0** (browser, API, and database `CHECK`) |
| Rate | Must not be negative |
| Tax rate | Between 0 and 100 inclusive |
| Text fields | Vendor 1-255, invoice number 1-100, line description 1-500 characters; **leading/trailing spaces are trimmed and blank values are rejected** in all three layers |
| Duplicates | Same organisation + vendor + invoice number is refused, **ignoring case and surrounding spaces** ("Tata Metals"/"tm-3842" equals "tata metals "/"TM-3842"). Enforced by a unique index, so simultaneous requests are also safe |
| Future-dated invoices | **Allowed.** Nothing in the browser, API or database rejects an invoice date in the future |
| Who can edit | Operators: Draft or Review only. Admins: any status (see "Open decision" below). Reviewers and Viewers: never |
| Rejected invoices | **Terminal**: no path back to Draft. Operators cannot edit them; Admins currently can (see below) |
| Approve / reject | Reviewers and Admins, never the invoice's creator, and only while the invoice is in Review |
| Approving what you saw | Every status change carries the invoice **version** the user was looking at. If it was edited meanwhile, the change is refused (HTTP 409) and the page reloads, so nobody approves content they have not seen |
| Line items required | An invoice needs **at least one line item** to be submitted for review or approved. Rejecting an empty invoice is still allowed, as the clean way to dispose of one. (`create_invoice()` cannot produce an empty invoice; this guards rows created by an older API build and anything inserted outside the app.) |

**Open decision -- editing Approved/Rejected invoices.** The assignment says Admins "can edit invoices" without limiting status, so Admins can currently edit an invoice even after it is Approved or Rejected; the status and `approved_by` are kept and the audit entry records the old and new totals. A stricter policy (block, or reset to Draft/Review for re-approval) is a one-line change in `update_invoice` and a deliberate business decision.

## Design notes

- **Transactions.** `create_invoice` and `update_invoice` do the invoice, line items, totals and audit row in one database transaction; any failure rolls everything back. The audit insert is part of that transaction, so an action cannot succeed without its history.
- **Race conditions.** `transition_invoice` locks the invoice row (`SELECT ... FOR UPDATE`), so of two simultaneous Approve/Reject exactly one wins and the loser sees "Invalid status transition".
- **Optimistic locking.** `invoices.version` increments on every change; edits *and* status changes must supply the version they loaded, otherwise HTTP 409 `VERSION_CONFLICT`.
- **Idempotency vs. the unique index.** The unique index stops two *different* requests creating the same business invoice. An `Idempotency-Key` makes *retrying the same request* safe: the same key and payload returns the original result instead of creating or failing again. A retry with the same key but a different payload is rejected.
- **Stale pages.** Chosen approach: **revalidate on tab focus/visibility** (`RevalidateOnFocus`, throttled to once per 5 s), not polling or Supabase Realtime. It needs no persistent connection or extra infrastructure and covers the real scenario (come back to a tab that went stale). Its limit: a tab left visible and idle does not update by itself. The version check above is the safety net: acting on stale data is refused rather than silently applied.
- **Slow requests.** Reads time out after 8 s; writes after 60 s. A write that times out reports "may or may not have been saved" and re-reads the real state, because aborting client-side does not cancel the server (the change may still commit).

## Upgrading an existing deployment (migrations 0013 and 0014)

`0013` changes the signature of `transition_invoice` (it now requires the version the user was looking at) and the API/web send it, so **the database, the API and the web app must all be updated together**. Between the steps below, Submit/Approve/Reject will fail until all three are live, so pick a quiet moment and do them back to back:

1. **Check your data first** (read-only, in the Supabase SQL Editor). `0013` refuses to run, with a message naming the rows, if two invoices would collide once case and spaces are ignored or if a vendor/invoice number/description is blank. Rows with no line items do not block the migrations, but cannot be submitted or approved afterwards (`0014`); fix them with *Edit invoice* or reject them:
   ```sql
   select i.invoice_number, i.status, i.total_amount
   from invoices i left join line_items l on l.invoice_id = i.id
   where l.id is null;
   ```
   And the two things `0013` itself checks (both should return no rows / 0):
   ```sql
   -- invoices that would collide once case and surrounding spaces are ignored
   select organization_id, lower(btrim(vendor)) as vendor, lower(btrim(invoice_number)) as invoice_number, count(*)
   from invoices group by 1, 2, 3 having count(*) > 1;

   -- blank (whitespace-only) values
   select (select count(*) from invoices  where btrim(vendor) = '' or btrim(invoice_number) = '') as blank_invoices,
          (select count(*) from line_items where btrim(description) = '')                            as blank_descriptions;
   ```
2. **Apply the migrations** `0013` then `0014` (`supabase db push`, or paste each file into the SQL Editor in order).
3. **Deploy the API.** If your host does not auto-deploy (Render's free tier can be set up that way), trigger a manual deploy of the latest commit and wait for "Live". A stale API is the classic failure here: an old build still tries direct table writes that the database now refuses (symptom: an invoice is created with a total but no line items, and editing says "Failed to update invoice").
4. **Deploy the web app.**
5. **Smoke test**: create an invoice (items and a "created" activity entry must appear), submit it, approve it as a different user.

## Known limitations

- Authentication is email/password via Supabase Auth, not OAuth/SSO.
- **Dependencies.** `npm audit --omit=dev` still reports 4 advisories (1 critical in `next`, 3 high in `fastify`/`find-my-way`/`postcss`) after applying every non-breaking fix, including Next 14.2.35. All remaining fixes are **major** upgrades (Next 16, Fastify 5) that were deliberately not forced. The Next advisories concern self-hosted deployments; this app is hosted on Vercel, but that mitigation has not been independently verified. Planned: Fastify 5 and Next 16 as their own, separately tested change. A plain `npm audit` reports more (currently 12) because it also counts **dev-only tooling** -- Vitest/Vite/esbuild and the ESLint config -- whose advisories concern a running dev server or a CLI flag this project never uses and which never ship to users; `npm audit --omit=dev` shows the 4 production advisories above. `npm audit fix --force` was deliberately not used: it would bump Next, Vitest and the ESLint config across major versions at once.
- `test_create_invoice_with_broken_audit` and the inert `test_activity_log_boom` trigger live in the production migrations (granted only to `service_role`). They should move to a test-only migration; left in place because changing already-applied migrations is riskier than documenting them.
- **Audit rollback test coverage.** The automated suite proves that a failing audit insert rolls back invoice *creation*. The same failure hook was used by hand to confirm that edits, status transitions, and adding/changing/removing members also roll back completely, but those paths have no automated test yet: the hook can only be switched on from SQL, so each would need its own service-role wrapper function.
- Invoice-number search uses `ILIKE '%term%'`, which cannot use a btree index. Fine at this scale; add a `pg_trgm` index if the table grows large.
- The free-tier API host (Render) sleeps when idle, so the first request can take 30-60 s.

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


## Project structure

```
apps/
  api/                    Fastify API
    src/
      server.ts           entry point (loads .env, listens)
      app.ts              builds the app: plugins, then feature modules
      config/env.ts       the only place environment variables are read
      plugins/            cross-cutting: cors, auth (JWT), tenant (org membership)
      shared/             supabase clients, http error helpers, uuid/search utils
      modules/
        invoices/         routes.ts (HTTP) / repository.ts (database) / errors.ts / schemas.ts / rules.ts
        members/  orgs/  activity/  health/
    test/                 unit + integration tests
  web/                    Next.js app (App Router)
    src/
      app/                routes only
      components/         ui/ layout/ invoices/ system/
      hooks/  lib/        client hooks, API client, Supabase helpers
      styles/             tokens.css, base.css, components/*.css (see styles/README.md)
packages/
  shared/                 roles, permissions, statuses and API response types used by BOTH apps
supabase/migrations/      database schema, RLS and the transactional SQL functions
scripts/                  seed and cleanup
```

Rule of thumb: the API route layer only validates, authorises and translates errors; database calls live in each module's `repository.ts`; business rules live in Postgres functions and `@invoice-app/shared`. Changing a role, permission or status in `packages/shared` changes it for the API and the UI together.

## Versions

Node 20.19+ (`.nvmrc` pins 22, which CI uses). Next.js 16 with React 19, Fastify 5, Tailwind 3, ESLint 9 (flat config), Vitest 5, TypeScript 5.9. `npm install` builds `packages/shared` automatically (postinstall). Known accepted audit findings are build-time only (Tailwind 3's file watcher and the Next ESLint plugin); none ship to production.
