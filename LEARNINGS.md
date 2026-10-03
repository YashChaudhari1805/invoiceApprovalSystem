# LEARNINGS

> **For the author to complete.** The assignment asks for 3-6 sentences per item *in your own
> words*. The "Where it's used" lines below are factual pointers into this repository to help you
> find the code; the explanation under each is left blank on purpose, because the point of this
> file is to show what *you* understood. Delete this note when you're done.

Questions worth answering for each item: What problem does it solve? What would go wrong without
it? What did you see happen while building or testing it?

---

## Transaction

**Where it's used:** `supabase/migrations/0007_atomic_create_invoice.sql` (`create_invoice`) and
`0008_atomic_edit_and_optimistic_locking.sql` (`update_invoice`). Rollback tests:
`apps/api/test/integration/atomic-invoice-create.test.ts`, `atomic-invoice-edit.test.ts`.

_Your explanation:_

## Race condition

**Where it's used:** the row lock in `transition_invoice` (`0006_transition_row_lock.sql`) and the
unique constraint on (organization, vendor, invoice number) in `0001_init.sql`. Tests: the
concurrent Approve-vs-Reject test in `routes-invoices-detail-transition.test.ts`; the
simultaneous-duplicate test in `tenant-and-rules.test.ts`.

_Your explanation:_

## RLS

**Where it's used:** the policies in `0001_init.sql` and later migrations; the lockdown of direct
writes in `0009_lockdown_and_audit.sql` (see "Direct writes are locked down" in `SCHEMA.md`).
Tests: `lockdown-and-audit.test.ts`, `tenant-and-rules.test.ts`.

_Your explanation:_

## Optimistic locking

**Where it's used:** the `invoices.version` column and the version check in `update_invoice`
(`0008`). UI: the conflict banner in
`apps/web/src/app/orgs/[orgId]/invoices/[invoiceId]/edit/form-client.tsx`. Tests: the stale-edit
tests in `atomic-invoice-edit.test.ts`.

_Your explanation:_

## Idempotency

**Where it's used:** `0012_idempotency.sql` and the `Idempotency-Key` handling in
`apps/api/src/routes/invoices.ts`; the key is generated once per form in
`apps/web/src/app/orgs/[orgId]/invoices/new/form-client.tsx`. Test: `idempotency.test.ts`.
_Also explain:_ how this differs from the vendor + invoice-number unique constraint.

_Your explanation:_

## Audit logs

**Where it's used:** the `activity_log` insert inside each `SECURITY DEFINER` function, in the same
transaction as the action (`0009_lockdown_and_audit.sql`). Direct inserts by normal users are not
allowed. Tests: the audit-rollback and fabricate-activity tests in `lockdown-and-audit.test.ts`.

_Your explanation:_

## SECURITY DEFINER

**Where it's used:** `create_invoice`, `update_invoice`, `transition_invoice`, `add_org_member`,
`update_member_role`, `remove_org_member`. Hardening in `0011_security_definer_hardening.sql`; the
written justification is in the README section "Why the SECURITY DEFINER functions are safe to
expose".

_Your explanation:_

## Integration testing

**Where it's used:** `apps/api/test/integration/`; shared setup and safety guard in
`apps/api/test/setup.ts`; throwaway organisations in `apps/api/test/helpers/test-org.ts`; CI in
`.github/workflows/ci.yml`. _Hint for your own reflection:_ which bugs could a unit test never have
caught, and which did these tests catch?

_Your explanation:_
