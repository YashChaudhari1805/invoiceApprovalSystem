import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Deliberately lazy: env vars are read the first time a client is actually
// needed (inside a request), not at module import time. This matters because
// `import` statements are hoisted and resolved before any other code in a
// file runs — so reading process.env at the top of this module would happen
// before a dotenv.config() call elsewhere in the app ever gets a chance to
// run, regardless of where that call is textually positioned.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

let _supabaseAdmin: SupabaseClient | null = null;

// Service-role client: bypasses RLS entirely. Used ONLY for verifying a
// user's access token (auth.getUser) — never for reading/writing tenant data,
// so a bug here can't accidentally leak across organizations.
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabaseAdmin;
}

// Per-request client, authenticated as the calling user via their own access
// token. Every query made through this client is subject to the RLS policies
// in 0001_init.sql — this is what makes RLS a real enforcement layer rather
// than a decorative one: the API server itself has no elevated access to
// tenant data, it only ever sees what the user themself is allowed to see.
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
