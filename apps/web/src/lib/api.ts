const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function apiFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store", 
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `API request to ${path} failed with status ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}
