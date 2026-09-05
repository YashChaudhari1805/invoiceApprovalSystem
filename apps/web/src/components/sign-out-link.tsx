"use client";

import { createClient } from "@/lib/supabase/client";

export function SignOutLink({ className }: { className?: string }) {
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
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
