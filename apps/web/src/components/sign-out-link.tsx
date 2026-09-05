"use client";

import { createClient } from "@/lib/supabase/client";

// Extracted so it can be used both inside AppShell's sidebar (for users with
// at least one org) and on the bare /orgs page for a user who has zero
// org memberships — that page can't render AppShell (there's no org to
// build a sidebar around), but the person still needs a way to sign out
// instead of being stuck editing cookies by hand.
export function SignOutLink({ className }: { className?: string }) {
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    // Hard navigation: guarantees the next request is a real fetch with the
    // cleared session, never a Router-Cache hit showing a stale page.
    window.location.href = "/login";
  }

  return (
    <button
      onClick={handleSignOut}
      className={className ?? "text-xs font-medium text-ink-500 transition hover:text-accent-600"}
    >
      Sign out
    </button>
  );
}
