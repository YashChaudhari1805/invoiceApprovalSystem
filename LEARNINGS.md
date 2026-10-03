# LEARNINGS

> **For the author to complete.** The assignment asks for 3-6 sentences per item *in your own
> words*. The "Where it's used" lines below are factual pointers into this repository to help you
> find the code; the explanation under each is intentionally left blank, because the point of
> this file is to show what *you* understood. Delete this note when you're done.

Questions worth answering for each item: What problem does it solve? What would go wrong without
it? What did you see happen while building or testing it?

---

## Transaction

**Where it's used:** `supabase/migrations/0007_atomic_create_invoice.sql` (`create_invoice`),
`0008_atomic_edit_and_optimistic_locking.sql` (`update_invoice`). Rollback tests:
`apps/api/test/integration/atomic-invoice-create.test.ts`, `atomic-invoice-edit.test.ts`.

_Your explanation:_

## Race condition

**Where it's used:** row lock in `transition_invoice` (`0006_transition_row_lock.sql`, current
version in `0013`); duplicate protection by a unique index (`0013`, previously a table constraint).
Tests: the concurrent Approve-vs-Reject test in `routes-invoices-detail-transition.test.ts`;
the simultaneous-duplicate test in `tenant-and-rules.test.ts`.

_Your explanation:_

## RLS

**Where it's used:** policies in `0001_init.sql` and later migrations; the lockdown that removed
direct writes in `0009_lockdown_and_audit.sql` and `0013_review_round_1_hardening.sql`. Tests:
`lockdown-and-audit.test.ts`, `review-hardening.test.ts` ("C1" and "C2" sections).
_Hint for your own reflection:_ RLS decides which rows a role may touch, but it sits on top of
table-level privileges (`GRANT`/`REVOKE`) -- compare what each one stopped in this project.

_Your explanation:_

## Optimistic locking

**Where it's used:** `invoices.version` (`0008`); `update_invoice` and, since `0013`,
`transition_invoice` both compare the version the user loaded. UI: the conflict banner in
`apps/web/src/app/orgs/[orgId]/invoices/[invoiceId]/edit/form-client.tsx` and the "changed while
you had it open" handling in `invoice-actions.tsx`. Tests: stale-edit tests in
`atomic-invoice-edit.test.ts`; stale-approval tests in `review-hardening.test.ts` ("H1").

_Your explanation:_

## Idempotency

**Where it's used:** `0012_idempotency.sql` and the `Idempotency-Key` handling in
`apps/api/src/routes/invoices.ts`; the key is generated once per form in
`apps/web/src/app/orgs/[orgId]/invoices/new/form-client.tsx`. Test: `idempotency.test.ts`.
_Also explain:_ how this differs from the vendor + invoice-number unique index.

_Your explanation:_

## Audit logs

**Where it's used:** the `activity_log` insert inside each `SECURITY DEFINER` function, in the same
transaction as the action (`0009`, `0013`). Direct inserts are no longer possible for client roles.
Tests: "audit rollback" and "fabricate activity" tests in `lockdown-and-audit.test.ts`; audit
metadata in `review-hardening.test.ts`.

_Your explanation:_

## SECURITY DEFINER

**Where it's used:** `create_invoice`, `update_invoice`, `transition_invoice`, `add_org_member`,
`update_member_role`, `remove_org_member`, `current_role_in_org`. Hardening in
`0011_security_definer_hardening.sql` and `0013`; the written justification is in the README
section "Why the SECURITY DEFINER functions are safe to expose".

_Your explanation:_

## Integration testing

**Where it's used:** `apps/api/test/integration/`; the shared setup and safety guard in
`apps/api/test/setup.ts`; throwaway organisations in `apps/api/test/helpers/test-org.ts`; CI in
`.github/workflows/ci.yml`. _Hint for your own reflection:_ which bugs could a unit test never have
caught, and which did these tests catch (or fail to catch)?

_Your explanation:_
