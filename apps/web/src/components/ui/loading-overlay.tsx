"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

/**
 * App-wide "blocking" loading indicator. Renders a full-viewport overlay
 * (fixed inset-0) so whatever's underneath — the form, the table, the nav —
 * can't be clicked, tabbed into, or double-submitted while an action is in
 * flight. Pair this with the same `isPending`/`loading` boolean that already
 * disables the triggering button; the overlay is what stops the *rest* of
 * the page from being interactive too.
 *
 * Usage: `<LoadingOverlay show={isPending} label="Saving invoice…" />`
 * Rendering `null` when `show` is false keeps this a no-op the rest of the
 * time — no layout cost, no stray DOM node.
 *
 * Portals to document.body rather than rendering in place: several call
 * sites drop this inside a <tr>/<tbody> (the members table) or inside a
 * <form>, where a fixed-position <div> is invalid child content. Without
 * the portal, the browser's HTML parser would relocate that markup during
 * the initial server-rendered paint, which then mismatches what React
 * expects at hydration. Mounting only after the component has mounted on
 * the client sidesteps document being unavailable during SSR.
 */
export function LoadingOverlay({ show, label = "Working…" }: { show: boolean; label?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!show || !mounted) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      // z-[100]: above the sticky invoice-action footer (which itself sits
      // at a lower stacking context) and above the mobile bottom nav.
      className="fixed inset-0 z-[100] flex items-center justify-center bg-canvas/70 backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-surface px-5 py-4 shadow-lg shadow-black/40">
        <Spinner className="h-5 w-5 shrink-0 text-accent-600" />
        <span className="text-sm font-medium text-ink-900">{label}</span>
      </div>
    </div>,
    document.body
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-80"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
