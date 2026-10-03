// Invoice dates are calendar dates ("2026-01-15"), not instants. Two classic
// bugs come from treating them as instants:
//
//   1. new Date("2026-01-15") is parsed as UTC midnight, so formatting it in a
//      timezone west of UTC shows the 14th.
//   2. new Date().toISOString().slice(0, 10) is today's date in UTC, so a user
//      in India (UTC+5:30) sees yesterday's date pre-filled until 05:30 local.
//
// These helpers work with the year/month/day parts directly.

/** Today's date in the user's own timezone, as YYYY-MM-DD (for <input type="date">). */
export function todayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Format a YYYY-MM-DD (or full ISO timestamp whose first 10 chars are the date)
 * as e.g. "15 Jan 2026", without any timezone shift. A fixed locale keeps the
 * server-rendered output identical wherever the server happens to run.
 */
export function formatInvoiceDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
