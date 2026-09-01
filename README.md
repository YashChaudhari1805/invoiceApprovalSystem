# Multi-Tenant Invoice Approval System

## What's in this starting point

This is a scaffold, not a finished app — it gives you the parts that are
hardest to get right and easiest to grade wrong:

- `prisma/schema.prisma` — full data model. `Membership` is the multi-tenancy
  backbone (one role per user per org). The `(organizationId, vendor,
  invoiceNumber)` unique constraint on `Invoice` makes duplicate protection
  safe under concurrent requests at the database level, not just in app code.
- `apps/api/src/plugins/auth.ts` — JWT verification.
- `apps/api/src/plugins/tenant.ts` — re-derives the caller's org membership
  from the DB on *every* request (never trusts a client-supplied org/role
  claim), plus a declarative permission table.
- `apps/api/src/modules/invoices/service.ts` — server-computed totals,
  explicit status-transition whitelist, and the maker-checker rule
  (creator can never approve/reject their own invoice).
- `apps/api/src/modules/invoices/list.ts` — search/filter/pagination done
  entirely in the DB query, never in the frontend.
- `prisma/seed.ts` — sample data matching the assignment's example
  (Rahul: Admin at ABC Steel / Viewer at XYZ Metals).

## Note: this project now uses Supabase

`prisma/schema.prisma` and the JWT/bcrypt auth code in `apps/api/src/plugins/auth.ts` were the pre-Supabase version and are superseded — see `SCHEMA.md` and `supabase/migrations/0001_init.sql` for the current source of truth. Auth is now handled by Supabase Auth (no hand-rolled login/JWT code needed); the API verifies the Supabase-issued JWT instead of issuing its own. If you still want Prisma for typed app queries against the Supabase Postgres instance, run `prisma db pull` against it to generate a client from the real schema rather than hand-maintaining both.

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL (Supabase or local Postgres) and JWT_SECRET
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev:api
```

Frontend (`apps/web`) is not scaffolded yet — `npx create-next-app@latest apps/web --typescript --tailwind --app` and wire it to the API.

## Testing

Two layers, both in `apps/api/test/`:

- **Unit tests** (`test/unit/`) — pure functions only (status transitions, permission table, maker-checker predicate, total calculation). No DB, no network, run in milliseconds: `npm run test:unit -w apps/api`
- **Integration tests** (`test/integration/`) — hit your real Supabase project as the actual seeded users (Rahul, Priya), verifying RLS policies and the `transition_invoice` RPC directly. These are what actually prove tenant isolation and maker-checker can't be bypassed, independent of whether the Fastify route code has a bug: `npm run test:integration -w apps/api`

Requires `.env` at the repo root with `SUPABASE_URL` and `SUPABASE_ANON_KEY`, and the seed data from `npm run seed` already applied. Run both: `npm run test -w apps/api`.

As you add Fastify routes on top of this, keep writing tests at the layer where the rule actually lives — a new business rule goes in `lib/invoice-rules.ts` + a unit test; a new access-control rule goes in an RLS policy or the RPC function + an integration test. Route handlers themselves should stay thin enough not to need much testing beyond "does it call the right thing and map errors to the right status code."

## Build order (matches how the pieces depend on each other)

1. **Auth + org switching** — login, JWT issue/verify, "which orgs am I a
   member of" endpoint, org switcher in the UI.
2. **Invoice CRUD + workflow** — create/edit, line items, submit for review,
   approve/reject, using the service functions already scaffolded.
3. **Listing + details + activity log** — server-side table, detail view
   with role-gated actions.
4. **Member management** — add/remove/change role, using `Membership`
   directly (never delete/recreate the `User`).
5. **Polish pass** — loading/empty/error states, seed script, README screenshots.

## Checklist — test each of these explicitly before submitting

- [ ] User A cannot fetch/edit/approve an invoice belonging to an org they're not a member of, even with a guessed/valid-looking invoice id
- [ ] Operator gets 403 attempting to approve/reject
- [ ] Viewer gets 403 attempting to create/edit
- [ ] Creator gets 403 attempting to approve their own invoice (even as Admin/Reviewer)
- [ ] Two near-simultaneous create requests with the same vendor+invoice number → one succeeds, one gets a clean 409
- [ ] Attempting an invalid transition (e.g. Draft → Approved directly) is rejected
- [ ] Same user, different role in different orgs, behaves correctly after switching org
- [ ] All of the above are enforced with the relevant UI action *hidden*, not just backend-blocked — but re-verify by hitting the API directly with curl/Postman, bypassing the UI entirely

## Notes for the writeup

Be honest in the README about what's done vs. simplified (e.g. "auth uses
email/password + JWT rather than a full OAuth provider for time reasons").
Reviewers trust submissions that state trade-offs more than ones that imply
everything is fully polished.
