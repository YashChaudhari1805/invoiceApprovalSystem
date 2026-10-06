import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { requireEnv } from "../config/env";

export interface VerifiedUser {
  userId: string;
  email: string;
}

// Lazily created on first use, env is read on first use, not at import.
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
