# Project Plan — Multi-Tenant Invoice Approval System

## 1. Technology map (what's used where and why)

| Layer | Technology | Why |
|---|---|---|
| Frontend framework | Next.js 14 (App Router) + React + TypeScript | Required by spec; App Router gives server components for the list/detail pages, reducing client-side data juggling |
| UI components | Tailwind CSS + shadcn/ui | Fast to build a clean, non-templated-looking UI without hand-rolling a design system |
| Frontend data fetching | React Query (TanStack Query) or native `fetch` in Server Components | Server Components for initial page load (SSR, no loading flash); React Query for client-side mutations (approve, edit, add member) with cache invalidation |
| Auth (session) | JWT issued by the API, stored in an httpOnly cookie | Avoids XSS-exposed localStorage; httpOnly cookie can't be read by injected JS |
| Backend framework | Node.js + Fastify + TypeScript | Required by spec; Fastify's schema-based validation (via Zod/JSON schema) doubles as request validation and docs |
| ORM | Prisma | Type-safe queries, first-class migrations, and the `@@unique` constraint we rely on for race-safe duplicate protection |
| Database | PostgreSQL (via Supabase or local) | Required by spec; relational model fits the org/membership/invoice/line-item structure naturally |
| Validation | Zod | Shared schema shapes between route input validation and (optionally) frontend form validation |
| Password hashing | bcryptjs | Standard, no native build step (easier in sandboxed/CI environments than bcrypt) |
| Testing | Vitest (backend unit/integration), Playwright (optional E2E for the critical-cases checklist) | Vitest is fast and TS-native; Playwright lets you script the exact "Operator tries to approve" scenarios as regression tests |
| Deployment | Vercel (frontend) + Supabase (DB) + Fly.io/Railway (API) or a single Railway deploy for both | Fastest path to a working public URL, which the spec explicitly asks for |

---

## 2. Work breakdown by section

Each section lists: what to build, the tech it touches, and what it depends on.

### 2.1 Authentication
- Build: `POST /auth/login` (verify bcrypt hash, issue JWT in httpOnly cookie), `POST /auth/logout` (clear cookie), `GET /auth/me` (current user + their org memberships)
- Tech: Fastify, `@fastify/jwt`, `@fastify/cookie`, bcryptjs, Zod for input validation
- Depends on: schema migrated + seeded
- Frontend: login form (client component), a root layout that redirects to `/login` if `/auth/me` 401s

### 2.2 Organizations & multi-tenancy
- Build: `GET /orgs` (orgs the current user belongs to), org switcher UI that sets "current org" in a URL segment (`/orgs/[orgId]/invoices`) rather than hidden client state — makes isolation testable by URL alone
- Tech: Next.js dynamic routes, the `requireMembership` Fastify hook already scaffolded
- Depends on: Auth done

### 2.3 Roles & permissions
- Build: the `PERMISSIONS` table (already scaffolded) wired into every route; frontend conditionally renders actions based on `GET /auth/me`'s per-org role, purely for UX (never as the actual security boundary)
- Tech: Fastify `preHandler` hooks, shared permission constants imported by both a route guard and (as a duplicated, deliberately non-authoritative copy) the frontend
- Depends on: Org/membership resolution working

### 2.4 Invoice management (CRUD)
- Build: `POST /orgs/:orgId/invoices` (create, server-computed totals — scaffolded), `GET /orgs/:orgId/invoices/:id`, `PATCH /orgs/:orgId/invoices/:id` (edit, blocked outside Draft/Review), line-item sub-forms with add/remove rows
- Tech: Prisma nested writes for line items, Zod schema for the line-item array, React Hook Form on the frontend for the multi-row form
- Depends on: schema + permission checks

### 2.5 Invoice workflow (status transitions)
- Build: `POST /orgs/:orgId/invoices/:id/transition` using the `ALLOWED_TRANSITIONS` map (scaffolded); frontend renders only the buttons valid for the invoice's current status + user's role
- Tech: Fastify route + the `transitionInvoice` service function already scaffolded
- Depends on: 2.4

### 2.6 Maker-checker
- Build: already implemented in `transitionInvoice` — creator ID compared against actor ID on every approve/reject call
- Tech: none new; this is a code-review/testing focus area, not a new component
- Depends on: 2.5. **Write an explicit test**: seed an invoice created by an Admin, assert that same Admin gets 403 on approve.

### 2.7 Invoice listing
- Build: `GET /orgs/:orgId/invoices?search=&vendor=&status=&page=` (scaffolded query logic), frontend table with URL-synced query params (so filters are shareable/bookmarkable and don't rely on client state)
- Tech: Prisma `where`/`skip`/`take` (scaffolded), Next.js `useSearchParams`/`router.push` for filter state
- Depends on: 2.4

### 2.8 Invoice details
- Build: `GET /orgs/:orgId/invoices/:id` returning invoice + line items + activity log; detail page composed of an info card, line-item table, action buttons (role- and status-gated), activity timeline
- Tech: Prisma `include` for line items + activity, a shared `<ActivityTimeline>` component reused wherever activity is shown
- Depends on: 2.5, 2.11

### 2.9 Duplicate invoice protection
- Build: already enforced by the `@@unique([organizationId, vendor, invoiceNumber])` constraint + the `P2002` → 409 translation in `createInvoice` (scaffolded)
- Tech: none new
- Depends on: schema migrated. **Test explicitly**: fire two concurrent create requests (e.g. `Promise.all`) with identical vendor/invoice number and assert exactly one succeeds.

### 2.10 Organization member management
- Build: `GET /orgs/:orgId/members`, `POST /orgs/:orgId/members` (invite/add by email), `PATCH /orgs/:orgId/members/:membershipId` (change role), `DELETE /orgs/:orgId/members/:membershipId`; admin-only screen with a members table + role dropdown
- Tech: `member:manage` permission (scaffolded), Prisma upsert on `Membership` (not `User`) so role changes never touch the account
- Depends on: 2.3

### 2.11 Audit history
- Build: `ActivityLog` writes already wired into invoice create/transition (scaffolded); add one for `MEMBER_ROLE_CHANGED` in 2.10's route; `GET` endpoint to list activity for an invoice (already covered by 2.8's include) and optionally an org-wide activity feed
- Tech: Prisma, the `ActivityLog` model (scaffolded)
- Depends on: 2.4, 2.10

### 2.12 Screens
- Login, Invoice List (org selector + search + filters + pagination), Invoice Create/Details (form, line items, submit/approve/reject, activity), Organization Members
- Tech: Next.js App Router pages/layouts, shadcn/ui form + table + dialog components
- Depends on: all corresponding API work above being done first (build backend-first per screen, not UI-first)

### 2.13 Important-cases validation
- Not new build — a dedicated half-day pass running the checklist from the earlier README against the running app with curl/Postman, bypassing the UI
- Tech: curl or a `.http`/Postman collection committed to the repo (also doubles as API documentation for the reviewer)

### 2.14 Submission packaging
- Build: README with setup/run instructions (drafted), migration files (from `prisma migrate dev`), seed script (scaffolded), a short "assumptions" section, and either a hosted demo link or clear local-run steps
- Depends on: everything else

---

## 3. Component interaction

### 3.1 High-level request flow

Every authenticated, org-scoped request follows the same path:

1. **Browser** sends a request with the httpOnly session cookie attached automatically.
2. **Fastify `authenticate` hook** verifies the JWT and attaches `req.user` (identity only — no role or org claims are trusted from the token).
3. **Fastify `requireMembership` hook** takes the `:orgId` from the URL, looks up `Membership` fresh from Postgres for `(req.user.userId, orgId)`, and attaches `req.membership.role`. No membership row → 403, before any invoice data is touched.
4. **Fastify `requirePermission` hook** checks `req.membership.role` against the static `PERMISSIONS` table for the specific action being attempted.
5. **Route handler / service function** (e.g. `transitionInvoice`) runs business rules that can't be expressed as a static permission — maker-checker, status-transition validity — against data freshly loaded from Postgres.
6. **Prisma** executes the query/mutation against Postgres, wrapping multi-step writes (e.g. status update + activity log entry) in a `$transaction` so they succeed or fail together.
7. **Response** goes back to the browser; **React Query** (or the Server Component's own refetch) updates the UI — the frontend never independently decides "is this action safe", it only decides "is this action worth *showing* to reduce clutter."

### 3.2 Why each hook exists as a separate layer

This is intentionally four discrete checks rather than one big `if` block, because each one answers a different question and a reviewer (or attacker) can be pointed at exactly the layer that would catch a specific attack:

- **authenticate** — *is this a real logged-in user?*
- **requireMembership** — *does this user have any relationship to this org at all?* (stops cross-tenant access even with a guessed/valid invoice ID, because every subsequent query is scoped by `organizationId`)
- **requirePermission** — *does this user's role allow this class of action?* (stops Operator-approves-invoice, Viewer-edits-invoice)
- **service-level business rules** — *is this specific action valid given the object's current state?* (stops Draft→Approved, stops maker approving their own invoice)

### 3.3 Frontend ↔ backend contract

- The frontend never computes financial totals, never filters/paginates a full invoice list locally, and never assumes an action is safe because a button is visible — it always calls the corresponding endpoint and handles a 403/409 gracefully (toast + revert optimistic UI, if used).
- All org-scoped API routes are shaped `/orgs/:orgId/...`, so the current org is always explicit in the URL, never inferred from hidden session state. This makes the "switch org" UX a navigation, not a hidden state mutation — and makes cross-tenant bugs easy to spot in the URL alone.

### 3.4 Data model relationships (see `prisma/schema.prisma`)

`User` —< `Membership` >— `Organization` is the multi-tenancy backbone: a `Membership` row is the only thing that grants a user any access to an org, and it carries the role. `Organization` —< `Invoice` —< `LineItem` is straightforward containment. `ActivityLog` rows reference both an `Invoice` (nullable, for org-level events like a member role change) and the `actorId` who performed the action, giving a single queryable audit trail across both invoice and membership events.
