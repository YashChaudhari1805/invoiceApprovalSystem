import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";

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

// Service-role client: bypasses RLS entirely. Kept around for the handful of
// operations that genuinely need elevated access (e.g. looking up a user by
// email when adding them to an org) — no longer used for routine token
// verification, see verifyAccessToken below.
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabaseAdmin;
}

export interface VerifiedUser {
  userId: string;
  email: string;
}

// Lazily created on first use, same reasoning as getSupabaseAdmin above.
// createRemoteJWKSet fetches Supabase's public signing keys and caches them
// in memory (with automatic refresh if a token references a key id it
// doesn't recognize yet, e.g. after key rotation) — so this still avoids a
// network round trip on every request, unlike calling
// supabaseAdmin.auth.getUser(token) would.
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(`${requireEnv("SUPABASE_URL")}/auth/v1/.well-known/jwks.json`));
  }
  return _jwks;
}

// Verifies a Supabase-issued access token LOCALLY against Supabase's public
// signing keys (JWKS) — no network call to the Auth API's /user endpoint for
// every single request. This project uses Supabase's newer asymmetric JWT
// signing keys (ES256/RS256), so verification needs the public key from
// JWKS rather than a single shared HS256 secret.
export async function verifyAccessToken(token: string): Promise<VerifiedUser> {
  const { payload } = await jwtVerify(token, getJwks());
  return { userId: payload.sub as string, email: payload.email as string };
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
