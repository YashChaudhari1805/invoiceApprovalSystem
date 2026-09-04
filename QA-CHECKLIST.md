# Manual QA Walkthrough

Run through this as the actual UI, not curl/Postman — the goal is catching anything that's technically enforced by the API but broken or confusing in the frontend. Check each box as you go; note anything that fails or feels wrong.

**Test accounts:** `rahul@example.com` (Admin @ ABC Steel, Viewer @ XYZ Metals) / `priya@example.com` (Reviewer @ ABC Steel) — both password `password123`.

---

## 1. Cross-org access via URL tampering
- [ ] Log in as **Rahul**. Go to ABC Steel → Invoices, open any invoice, note its URL (`/orgs/<abc-steel-id>/invoices/<invoice-id>`).
- [ ] Switch org to **XYZ Metals** via the sidebar switcher.
- [ ] Manually edit the URL back to the ABC Steel invoice you just viewed (same invoice id, but you're now "in" XYZ Metals context).
- [ ] **Expect:** either a 404 / "invoice not found" — never the actual invoice data. If you see the invoice, that's a real bug, stop and report it immediately.

## 2. Operator attempting to approve
- [ ] As Rahul (Admin), go to Members, temporarily add a throwaway account as **Operator** in ABC Steel (or change your own test user's role if you have one).
- [ ] Log in as that Operator. Open an invoice that's in **Review** status.
- [ ] **Expect:** no Approve/Reject buttons visible at all.
- [ ] (Optional, stronger check) Open browser dev tools → Network tab, try re-sending a transition request with `toStatus: "APPROVED"` manually. Expect a `403`.

## 3. Viewer attempting to edit
- [ ] Log in as **Rahul** and switch to **XYZ Metals** via the sidebar — he's a Viewer there (unlike ABC Steel, where he's Admin).
- [ ] Open any invoice in XYZ Metals.
- [ ] **Expect:** no Edit link, no New Invoice button anywhere, no action buttons — Viewer is read-only everywhere.

## 4. Creator approving their own invoice (maker-checker)
- [ ] As **Rahul**, create a new invoice in ABC Steel, submit it for review.
- [ ] While still logged in as Rahul, open that invoice.
- [ ] **Expect:** even though Rahul is Admin (who normally can approve), no Approve/Reject buttons show on his own invoice.
- [ ] Log out, log in as **Priya**, open the same invoice.
- [ ] **Expect:** Priya sees Approve/Reject and can successfully approve it.

## 5. Duplicate invoice creation
- [ ] As Rahul, create an invoice with vendor `Test Vendor Co` and invoice number `DUP-001`.
- [ ] Try creating a second invoice with the exact same vendor + invoice number in the same org.
- [ ] **Expect:** a clear error message, not a silent failure or a generic 500-looking crash.
- [ ] Try the same vendor + invoice number in a **different** org (e.g. XYZ Metals if you have Operator/Admin there) — this should succeed, since duplicate protection is scoped per-org.

## 6. Invalid status transitions
- [ ] Create a fresh Draft invoice. Before submitting it for review, check there's no way in the UI to jump straight to Approved/Rejected.
- [ ] After it's Approved (via the normal flow), reopen it and confirm no action buttons remain — Approved is terminal.

## 7. Same user, different roles in different orgs
- [ ] As Rahul, on ABC Steel: confirm you can create, edit, and would-be-approve (on someone else's invoice) — full Admin capability.
- [ ] Switch to XYZ Metals: confirm the "New invoice" button is gone (Viewer can't create), and any invoice you open shows no action buttons at all.

## 8. Multi-tenancy / data isolation in normal use
- [ ] With Rahul on ABC Steel, note a couple of invoice numbers.
- [ ] Switch to XYZ Metals. Confirm the invoice list is empty or shows only XYZ Metals' own invoices — never anything from ABC Steel.
- [ ] Search/filter on XYZ Metals for one of the ABC Steel invoice numbers you noted. Confirm zero results.

## 9. Member management edge cases
- [ ] As Rahul, try changing your own role in the Members screen. **Expect:** disabled, with an explanatory note (already built this way — confirm it holds).
- [ ] Try adding a member by an email that has no account. **Expect:** a clear "no user found" error, not a crash.
- [ ] Add someone, change their role, confirm the change reflects immediately without needing a page refresh.
- [ ] Remove someone, confirm they disappear from the list immediately.

## 10. Pagination and filters
- [ ] If ABC Steel has more than 20 invoices (it will, from earlier testing before cleanup — or create a few), confirm Previous/Next actually move between pages and the count at the bottom matches.
- [ ] Apply a status filter, confirm the URL updates (so it's shareable/bookmarkable) and the page resets to 1.

---

## After this pass
Note any failures here with enough detail to reproduce (which user, which org, which click), and bring them back — each one is likely a quick, specific fix rather than something requiring a redesign at this stage.
