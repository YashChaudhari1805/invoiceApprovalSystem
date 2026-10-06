"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Any module can call this directly to start the bar — used for
// navigations triggered programmatically (router.push from Pagination /
// InvoiceFilters) that don't originate from a plain <a> click and so
// wouldn't be caught by the document click listener below.
let externalStart: (() => void) | null = null;
export function startRouteProgress() {
  externalStart?.();
}

/**
 * Top-of-viewport progress bar shown for every route change — the
 * "something is happening" signal for the couple of seconds a server
 * component page takes to fetch its data, distinct from the per-route
 * `loading.tsx` skeletons (which only cover the segment that actually
 * changed; a navigation that also remounts the `orgs/[orgId]` layout, e.g.
 * switching orgs, has no skeleton of its own to fall back on without one).
 *
 * Two start triggers:
 *  1. A capture-phase click listener on `document` — catches every
 *     next/link `<a>` click app-wide (nav pills, org switcher, table rows,
 *     "New invoice", etc.) without touching each of those components.
 *  2. `startRouteProgress()`, called explicitly by components that
 *     navigate via `router.push()` from a button rather than an anchor
 *     click (Pagination, InvoiceFilters).
 *
 * Finishes automatically once the URL (pathname or search params) actually
 * changes, with a capped safety timeout in case a click never results in a
 * navigation (permission redirect loops, a link back to the current page).
 */
function RouteProgressBarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0); // 0 = hidden
  const [visible, setVisible] = useState(false);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; safety?: ReturnType<typeof setTimeout> }>({});

  function start() {
    clearInterval(timers.current.tick);
    clearTimeout(timers.current.safety);
    setVisible(true);
    setProgress(12);
    // Trickles toward 85% and stalls there — the classic "we don't know
    // the real duration" progress bar, standard on GitHub/YouTube/etc.
    // The remaining 15% is reserved for the finish() snap below, which
    // reads as "it just completed" rather than "it stalled".
    timers.current.tick = setInterval(() => {
      setProgress((p) => (p >= 85 ? p : p + (85 - p) * 0.12 + 1));
    }, 200);
    // Safety net: if navigation never lands (blocked redirect, link to the
    // current page, a thrown error before the URL changes), don't leave the
    // bar stuck forever.
    timers.current.safety = setTimeout(() => finish(), 6000);
  }

  function finish() {
    clearInterval(timers.current.tick);
    clearTimeout(timers.current.safety);
    setProgress(100);
    setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 200);
  }

  useEffect(() => {
    externalStart = start;
    return () => {
      externalStart = null;
    };
  }, []);

  // The URL actually changing is the real "navigation is done" signal,
  // regardless of what started the bar.
  useEffect(() => {
    finish();
    return () => {
      clearInterval(timers.current.tick);
      clearTimeout(timers.current.safety);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // modified click = new tab, let the browser handle it

      const anchor = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // external link — full page load, browser shows its own indicator

      const samePath = url.pathname === window.location.pathname && url.search === window.location.search;
      const hashOnly = samePath && url.hash !== window.location.hash;
      if (samePath || hashOnly) return; // no-op link or in-page anchor jump

      start();
    }

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-0.5 bg-transparent">
      <div
        className="h-full bg-accent-600 shadow-[0_0_8px_rgb(var(--color-accent-600)/0.8)] transition-[width] duration-200 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export function RouteProgressBar() {
  // useSearchParams requires a Suspense boundary around whatever reads it.
  return (
    <Suspense fallback={null}>
      <RouteProgressBarInner />
    </Suspense>
  );
}
