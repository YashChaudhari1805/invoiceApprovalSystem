# LEARNINGS

Short notes on the main concepts from Part 2, each with where it is used in this project.

## Transaction

A transaction groups several database writes into one all-or-nothing unit: either every write is saved, or none of them are. Creating an invoice needs three writes (the invoice row, its line items, and an activity-log entry), and without a transaction a failure halfway through leaves an invoice with a total but no items. The first version of this app worked that way. Now `create_invoice()` (`supabase/migrations/0007_atomic_create_invoice.sql`) and `update_invoice()` (`0008_atomic_edit_and_optimistic_locking.sql`) do all their writes inside a single Postgres function, so any error rolls everything back. The tests in `apps/api/test/integration/atomic-invoice-create.test.ts` and `atomic-invoice-edit.test.ts` force a failure part-way through and check that no half-made invoice is left behind.

## Race condition

A race condition is when two requests touch the same data at almost the same moment and the result depends on which one wins, even though each request is correct on its own. The example here is two reviewers pressing Approve and Reject on the same invoice: both see "In review", and without protection both could succeed. `transition_invoice()` (`0006_transition_row_lock.sql`) locks the invoice row with `SELECT ... FOR UPDATE`, so the second request waits, then finds the invoice is no longer in Review and fails. Duplicate creation is protected the same way by a unique constraint on organisation + vendor + invoice number, which lets only one of two simultaneous identical creates through. Both cases have concurrent tests (`routes-invoices-detail-transition.test.ts` and `tenant-and-rules.test.ts`).

## RLS

Row Level Security is a set of Postgres rules that decide which rows a signed-in user may read or change, and it still applies if someone skips the app and calls Supabase directly. The policies in `0001_init.sql` make every table readable only by members of the organisation, which is what keeps tenants isolated from each other. `0009_lockdown_and_audit.sql` goes further and removes direct write access to line items, the audit log and invoice updates, so those can only change through the controlled functions. One known gap, listed under "Known limitations" in the README: direct creation of invoices and direct membership changes are still allowed by RLS, so the API is the main gate for those. The tests are in `lockdown-and-audit.test.ts` and `tenant-and-rules.test.ts`.

## Optimistic locking

Optimistic locking stops one user from silently overwriting another user's newer changes. Each invoice has a `version` number that goes up on every change (`0008`), and an edit only succeeds if the version it was based on is still the current one. The edit form sends the version it loaded; if someone else saved first, `update_invoice()` answers with a conflict (HTTP 409) and the form shows "This invoice was changed by another user. Refresh before saving again." The tests in `atomic-invoice-edit.test.ts` check that a second save based on the old version cannot overwrite the first, including when two edits are fired at the same instant.

## Idempotency

An idempotent request can be repeated safely: sending it twice has the same effect as sending it once, which matters when a slow connection makes a user click twice or a client retries. The create-invoice form generates one key per form (`crypto.randomUUID()` in `new/form-client.tsx`) and sends it as an `Idempotency-Key` header. `create_invoice()` (`0012_idempotency.sql`) stores the key with a hash of the request in `idempotency_keys`, and when the same key arrives with the same data it returns the original invoice instead of creating another. This is different from the vendor + invoice-number unique constraint: the constraint rejects a *different* request for the same business invoice with an error, while idempotency recognises a *retry of the same request* and answers it successfully with the original result. `idempotency.test.ts` includes ten concurrent retries that produce exactly one invoice.

## Audit logs

An audit log is business data that records who did what and when, so in an approval system it has to be reliable and hard to fake, unlike a debug log. Every create, edit, status change and member change writes an `activity_log` row inside the same function and transaction as the action itself, so if the audit insert fails the action is rolled back too. Status changes store the old and new status, edits store which fields were changed, and normal users cannot insert audit rows directly (`0009_lockdown_and_audit.sql`). `lockdown-and-audit.test.ts` forces an audit failure and checks that the invoice is not left behind, and checks that a direct insert into the log is refused.

## SECURITY DEFINER

A `SECURITY DEFINER` function runs with its owner's privileges instead of the caller's. That lets a user perform one controlled operation, such as creating an invoice together with its audit entry, without having direct write access to the tables, but it also means the function has extra power and must be written carefully. The business functions (`create_invoice`, `update_invoice`, `transition_invoice` and the member-management functions) each check who the caller is (`auth.uid()`), their role in that organisation, and whether the action is allowed before writing anything. Each one pins `search_path = public` so it cannot be tricked into using a look-alike object, and each does one narrow job; `0011_security_definer_hardening.sql` fixed the two helper functions that were missing this. The README section "Why the SECURITY DEFINER functions are safe to expose" explains the reasoning.

## Integration testing

An integration test runs several real layers together (here the Fastify API, the Supabase database and its security rules) instead of one function in isolation, so it can catch problems a unit test never sees, such as a missing permission or a database rule behaving differently from what the code assumed. The tests in `apps/api/test/integration/` sign in as real users and check things like cross-tenant access being refused and simultaneous requests resolving correctly. Each test file creates its own disposable organisation (`apps/api/test/helpers/test-org.ts`), and `apps/api/test/setup.ts` refuses to run against a hosted database unless it is explicitly confirmed as a test project, so real data is not touched. The README explains the environment variables and setup, and `.github/workflows/ci.yml` runs the unit tests and builds on every push, plus the integration tests when a test Supabase project is configured as secrets.
