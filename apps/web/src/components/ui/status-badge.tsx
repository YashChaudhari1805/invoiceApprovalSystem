const VARIANT: Record<string, string> = {
  DRAFT: "stamp-draft",
  REVIEW: "stamp-review",
  APPROVED: "stamp-approved",
  REJECTED: "stamp-rejected",
};

const LABELS: Record<string, string> = {
  DRAFT: "Draft",
  REVIEW: "In review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/** Invoice status rendered as an inked stamp. Styles live in styles/components/stamp.css. */
export function StatusBadge({ status, large = false }: { status: string; large?: boolean }) {
  return (
    <span className={`stamp ${VARIANT[status] ?? "stamp-draft"} ${large ? "stamp-lg" : ""}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
