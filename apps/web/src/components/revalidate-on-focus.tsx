"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page in sync with the database while the tab sits
 * open in the background.
 *
 * Scenario this fixes: an approver opens an invoice, switches to another
 * tab (or app) for a few minutes, and in the meantime a second approver
 * (or the requester, editing it) changes the invoice elsewhere. When the
 * first approver switches back, the page they're looking at is a snapshot
 * from whenever it was first rendered — same status badge, same available
 * actions, same activity log — until something tells Next.js to re-fetch it.
 *
 * This component calls `router.refresh()` (a server-component re-fetch: it
 * re-runs the page's data loading and swaps in fresh markup, not a full
 * document reload — no lost scroll position, no client state reset) whenever
 * the tab becomes visible again or the window regains focus. It's throttled
 * so rapid focus/blur toggling (switching apps repeatedly, alt-tabbing)
 * can't spam the API with refetches.
 *
 * Render this once per page that needs it; it has no UI of its own.
 */
export function RevalidateOnFocus({ minIntervalMs = 5000 }: { minIntervalMs?: number }) {
  const router = useRouter();
  const lastRefresh = useRef(Date.now());

  useEffect(() => {
    function maybeRefresh() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefresh.current < minIntervalMs) return;
      lastRefresh.current = now;
      router.refresh();
    }

    document.addEventListener("visibilitychange", maybeRefresh);
    window.addEventListener("focus", maybeRefresh);
    return () => {
      document.removeEventListener("visibilitychange", maybeRefresh);
      window.removeEventListener("focus", maybeRefresh);
    };
  }, [router, minIntervalMs]);

  return null;
}
