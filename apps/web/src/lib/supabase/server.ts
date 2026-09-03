import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// Used inside Server Components, Route Handlers, and Server Actions. Reads
// the session from the incoming request's cookies — this is what lets a
// Server Component fetch data as the logged-in user (and therefore subject
// to RLS) without a client-side round trip.
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll is called from a Server Component in some cases (e.g.
            // during static rendering), where cookies can't be written.
            // Safe to ignore as long as middleware.ts is also refreshing
            // the session on every request.
          }
        },
      },
    }
  );
}
