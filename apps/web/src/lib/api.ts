const API_URL = process.env.API_URL ?? "http://localhost:4000";

// A free-tier host (Render, in this app's case — see README) can take
// 30-60s to wake from a cold start; a Vercel serverless function has its
// own execution limit that's often shorter than that (10s on Hobby). Left
// unbounded, a sleeping API doesn't fail loudly — it just hangs until
// Vercel kills the function, which surfaces as an opaque
// "Application error: a server-side exception has occurred" with no
// indication of what actually went wrong. This timeout fails fast instead,
// with a message that says what to check.
const REQUEST_TIMEOUT_MS = 8000;

// Thrown for any non-2xx response from the API. It's still a plain Error (so
// existing `err instanceof Error` handling keeps working), but also carries the
// HTTP status and the API's machine-readable `code`, so callers can react to
// specific cases — e.g. "VERSION_CONFLICT" when an edit is based on an
// out-of-date copy of an invoice — without matching on message text.
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `API request to ${path} timed out after ${REQUEST_TIMEOUT_MS}ms. ` +
          `If the API is hosted on a free tier that sleeps when idle, this is likely a cold start — ` +
          `check ${API_URL}/health directly, or wait ~60s and retry.`
      );
    }
    // Anything else here is a genuine connection failure (DNS, refused,
    // TLS) — most commonly API_URL pointing at the wrong host/being unset
    // in this environment's config, so say that explicitly rather than
    // just rethrowing the raw fetch error.
    throw new Error(
      `Couldn't reach the API at ${API_URL}${path} — check that API_URL is set correctly for this ` +
        `environment. (${err instanceof Error ? err.message : String(err)})`
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.error ?? `API request to ${path} failed with status ${res.status}`,
      res.status,
      typeof body.code === "string" ? body.code : undefined
    );
  }

  if (res.status === 204) return null;
  return res.json();
}
