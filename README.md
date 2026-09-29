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
npm run test:unit -w apps/api          # pure business-rule tests, no DB, runs in ms
npm run test:integration -w apps/api   # hits your real Supabase project as the seeded users
```

The integration suite is the one worth reading if you want to see the security model actually exercised: it logs in as real users and asserts that cross-tenant access, maker-checker violations, invalid status transitions, and duplicate invoices are all rejected -- both through the API and, in several tests, by attempting the same operations directly against Supabase to confirm RLS enforces it independently of the API layer.

Tests that create data run against disposable throwaway organizations (see `apps/api/test/helpers/test-org.ts`) created and torn down per test file, so running the suite never pollutes the real seed data.

## Manual QA

`QA-CHECKLIST.md` is a click-through script covering every "important case" from the assignment spec, run as the actual UI rather than via the API directly -- worth doing at least once before treating this as done.

## Known simplifications / assumptions

- Authentication is email/password via Supabase Auth rather than a full OAuth/SSO setup -- reasonable for the assignment's timeframe.
- A Rejected invoice is currently terminal (no path back to Draft for resubmission) -- the spec doesn't specify this case, and this was the simpler interpretation.
- Vendor names are free text; "Tata Metals" and "tata metals" are treated as different vendors for duplicate-detection purposes (case-sensitive).
- The free-tier API host (Render) sleeps after inactivity, causing a slow first request after idle periods. Not a code issue -- would not occur on a paid tier or with a keep-alive ping.

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
