import { createBrowserClient } from "@supabase/ssr";

// Used inside Client Components (anything with "use client"). Reads/writes
// the session via cookies automatically so it stays in sync with the
// server-side client below.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
