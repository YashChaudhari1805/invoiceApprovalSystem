import { Skeleton } from "@/components/skeleton";

/**
 * Covers orgs/[orgId]/layout.tsx itself, not just the page below it.
 *
 * Every page under this route already has its own loading.tsx (invoices,
 * invoice detail, members, activity) — those cover navigating *between*
 * pages within the same org. What none of them cover is the layout's own
 * data fetch (session + org list), which re-runs whenever the [orgId]
 * segment changes: switching orgs via the switcher, or the very first
 * click into an org from /orgs. Without a loading.tsx at this level, that
 * fetch has no Suspense boundary above it, so the whole navigation just
 * sits there with no feedback until it resolves — the exact "2-3 seconds
 * and nothing tells you it's working" gap.
 *
 * Shaped to roughly match AppShell's sidebar + content layout so there's
 * minimal visual jump when the real shell mounts underneath it.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-100 bg-surface md:flex">
        <div className="border-b border-ink-100 px-5 py-5">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="flex-1 space-y-2 px-3 py-4">
          <Skeleton className="h-8 w-full rounded-full" />
          <Skeleton className="h-8 w-full rounded-full" />
          <Skeleton className="h-8 w-full rounded-full" />
        </div>
        <div className="border-t border-ink-100 px-5 py-4">
          <Skeleton className="h-3 w-28" />
        </div>
      </aside>

      <header className="flex items-center justify-between gap-2 border-b border-ink-100 bg-surface px-4 py-3 md:hidden">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-10" />
      </header>

      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <Skeleton className="mb-2 h-6 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-9 w-28" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ink-100 bg-surface py-2 md:hidden">
        <Skeleton className="mx-4 h-8 w-full" />
      </nav>
    </div>
  );
}
