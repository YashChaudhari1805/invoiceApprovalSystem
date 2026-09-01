import { describe, it, expect } from "vitest";
import {
  isValidTransition,
  canApprove,
  computeInvoiceTotals,
  can,
} from "../../src/lib/invoice-rules";

describe("status transitions", () => {
  it("allows Draft -> Review", () => {
    expect(isValidTransition("DRAFT", "REVIEW")).toBe(true);
  });

  it("allows Review -> Approved and Review -> Rejected", () => {
    expect(isValidTransition("REVIEW", "APPROVED")).toBe(true);
    expect(isValidTransition("REVIEW", "REJECTED")).toBe(true);
  });

  it("rejects skipping straight from Draft to Approved", () => {
    expect(isValidTransition("DRAFT", "APPROVED")).toBe(false);
  });

  it("rejects any transition out of a terminal state", () => {
    expect(isValidTransition("APPROVED", "REVIEW")).toBe(false);
    expect(isValidTransition("REJECTED", "DRAFT")).toBe(false);
  });
});

describe("role permissions", () => {
  it("Operator can create but not approve", () => {
    expect(can("OPERATOR", "invoice:create")).toBe(true);
    expect(can("OPERATOR", "invoice:approve")).toBe(false);
  });

  it("Viewer can view but nothing else", () => {
    expect(can("VIEWER", "invoice:view")).toBe(true);
    expect(can("VIEWER", "invoice:create")).toBe(false);
    expect(can("VIEWER", "invoice:approve")).toBe(false);
  });

  it("only Admin can manage members", () => {
    expect(can("ADMIN", "member:manage")).toBe(true);
    expect(can("REVIEWER", "member:manage")).toBe(false);
  });
});

describe("maker-checker rule", () => {
  it("blocks a Reviewer from approving their own invoice", () => {
    const ok = canApprove({ actorId: "user-1", creatorId: "user-1", role: "REVIEWER" });
    expect(ok).toBe(false);
  });

  it("blocks even an Admin from approving their own invoice", () => {
    const ok = canApprove({ actorId: "user-1", creatorId: "user-1", role: "ADMIN" });
    expect(ok).toBe(false);
  });

  it("allows a different Reviewer to approve", () => {
    const ok = canApprove({ actorId: "user-2", creatorId: "user-1", role: "REVIEWER" });
    expect(ok).toBe(true);
  });

  it("blocks an Operator from approving regardless of who created it", () => {
    const ok = canApprove({ actorId: "user-2", creatorId: "user-1", role: "OPERATOR" });
    expect(ok).toBe(false);
  });
});

describe("invoice total computation", () => {
  it("computes taxable, tax, and total across multiple line items", () => {
    const result = computeInvoiceTotals([
      { quantity: 2, rate: 100, taxRate: 18 }, // taxable 200, tax 36, amount 236
      { quantity: 1, rate: 50, taxRate: 5 },   // taxable 50, tax 2.5, amount 52.5
    ]);
    expect(result.taxableAmount).toBe(250);
    expect(result.taxAmount).toBe(38.5);
    expect(result.totalAmount).toBe(288.5);
    expect(result.lineItems[0].amount).toBe(236);
    expect(result.lineItems[1].amount).toBe(52.5);
  });

  it("handles a zero-tax line item", () => {
    const result = computeInvoiceTotals([{ quantity: 3, rate: 10, taxRate: 0 }]);
    expect(result.taxAmount).toBe(0);
    expect(result.totalAmount).toBe(30);
  });

  it("does not accumulate floating point drift over many line items", () => {
    const lineItems = Array.from({ length: 10 }, () => ({ quantity: 1, rate: 0.1, taxRate: 10 }));
    const result = computeInvoiceTotals(lineItems);
    // 10 * 0.1 = 1.00 taxable; naive floating point addition can drift to
    // 0.9999999999999999 without rounding at each step.
    expect(result.taxableAmount).toBe(1);
  });
});
