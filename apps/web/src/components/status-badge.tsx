const STYLES: Record<string, string> = {
  DRAFT: "bg-ink-100 text-ink-700",
  REVIEW: "bg-amber-100 text-amber-600",
  APPROVED: "bg-mint-100 text-mint-500",
  REJECTED: "bg-rose-100 text-rose-600",
};

const LABELS: Record<string, string> = {
  DRAFT: "Draft",
  REVIEW: "In review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STYLES[status] ?? "bg-ink-100 text-ink-700"
      }`}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
