import { STATUS_LABELS, type InvoiceStatus } from "@invoice-app/shared";

const VARIANT: Record<string, string> = {
  DRAFT: "stamp-draft",
  REVIEW: "stamp-review",
  APPROVED: "stamp-approved",
  REJECTED: "stamp-rejected",
};

/** Invoice status rendered as an inked stamp. Styles live in styles/components/stamp.css. */
export function StatusBadge({ status, large = false }: { status: string; large?: boolean }) {
  return (
    <span className={`stamp ${VARIANT[status] ?? "stamp-draft"} ${large ? "stamp-lg" : ""}`}>
      {STATUS_LABELS[status as InvoiceStatus] ?? status}
    </span>
  );
}
