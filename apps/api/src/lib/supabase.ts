import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
}

// Service-role client: bypasses RLS entirely. Used ONLY for verifying a
// user's access token (auth.getUser) — never for reading/writing tenant data,
// so a bug here can't accidentally leak across organizations.
export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Per-request client, authenticated as the calling user via their own access
// token. Every query made through this client is subject to the RLS policies
// in 0001_init.sql — this is what makes RLS a real enforcement layer rather
// than a decorative one: the API server itself has no elevated access to
// tenant data, it only ever sees what the user themself is allowed to see.
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
