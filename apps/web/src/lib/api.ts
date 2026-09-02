// Server-only — reads API_URL (not NEXT_PUBLIC_*, since this never runs in
// the browser: all calls to the Fastify API happen from Server Components/
// Actions, using the access token pulled from the user's Supabase session).
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function apiFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store", // invoice/org data is per-user and changes frequently; never cache
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `API request to ${path} failed with status ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}
