# Multi-Tenant Invoice Approval System

A working multi-tenant web application for creating, reviewing, and approving purchase invoices, with role-based permissions, a maker-checker approval rule, and full audit history.

**Live demo:** _add your deployed URLs here once confirmed working_
- Frontend: `https://<your-app>.vercel.app`
- API: `https://<your-api>.onrender.com` (free tier — the first request after a period of inactivity may take 30-60s to wake up)

## Tech stack

- **Frontend:** Next.js 14 (App Router) + React + TypeScript + Tailwind CSS
- **Backend:** Node.js + Fastify + TypeScript
- **Database & Auth:** Supabase (PostgreSQL + Row Level Security + Supabase Auth)

## Architecture at a glance

Every org-scoped request passes through, in order: **authenticate** (verifies the Supabase-issued JWT locally against Supabase's public JWKS keys, no network round trip) -> **requireMembership** (re-derives the caller's role fresh from the database on every request, scoped by RLS) -> **requirePermission** (checks role against a static permission table) -> route-specific business logic (maker-checker, status transitions, etc.).

Row Level Security policies in Postgres are a second, independent enforcement layer underneath the API -- even a bug in the Fastify layer can't leak data across tenants or bypass maker-checker, because the database itself refuses those operations. See `SCHEMA.md` for the full data model and `PLAN.md` for the original architecture writeup.

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

This creates two real Supabase Auth users (`rahul@example.com`, `priya@example.com`, both password `password123`) and two organizations, matching the assignment's example: Rahul is Admin at ABC Steel and Viewer at XYZ Metals; Priya is Reviewer at ABC Steel.

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
