"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LoadingOverlay } from "@/components/ui/loading-overlay";

// Base look always applies — a proper outlined pill button rather than a
// plain text link, so it doesn't get lost as an afterthought next to the
// theme toggle. `className` is layout-only (margin/spacing per call site),
// appended on top rather than replacing this.
const BASE_CLASSES =
  "inline-flex items-center justify-center gap-1 rounded-full border border-ink-100 px-3 py-1 text-xs font-medium text-ink-700 transition hover:border-accent-500 hover:bg-accent-50 hover:text-accent-600 disabled:opacity-50";

export function SignOutLink({ className }: { className?: string }) {
  const supabase = createClient();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    // Deliberate hard navigation: the next page load must be a real request carrying the new session cookie.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  return (
    <>
      <LoadingOverlay show={signingOut} label="Signing out…" />
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        className={`${BASE_CLASSES} ${className ?? ""}`}
      >
        Sign out
      </button>
    </>
  );
}
