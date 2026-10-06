import { headers } from "next/headers";
import { redirect } from "next/navigation";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export function getApiUrl() {
  return API_URL;
}

// A free-tier host (Render, in this app's case — see README) can take
// 30-60s to wake from a cold start; a Vercel serverless function has its
// own execution limit that's often shorter than that (10s on Hobby). Left
// unbounded, a sleeping API doesn't fail loudly — it just hangs until
// Vercel kills the function, which surfaces as an opaque
// "Application error: a server-side exception has occurred" with no
// indication of what actually went wrong. This timeout fails fast instead,
// with a message that says what to check.
const READ_TIMEOUT_MS = 8000;

// Writes get a much longer budget. Aborting a write on the client does NOT
// cancel it on the server: the database may well commit after we gave up. A
// short timeout on a mutation therefore does not mean "it failed" — it means
// "we no longer know", and reporting it as a failure is actively misleading
// (the user retries, or believes nothing changed). So writes wait longer, and
// if they still time out we say honestly that the outcome is unknown.
const WRITE_TIMEOUT_MS = 60000;

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

// Thrown when a WRITE gets no response in time. The server may still have
// committed the change, so callers must not tell the user it "failed".
export class ApiOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiOutcomeUnknownError";
  }
}

export async function apiFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const isWrite = !!init.method && init.method.toUpperCase() !== "GET";
  const timeoutMs = isWrite ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
    const timedOut = err instanceof Error && err.name === "AbortError";
    // Full technical detail goes to the server log; the user gets a plain-language message.
    console.error(`[api] ${init.method ?? "GET"} ${path} failed (${timedOut ? "timeout" : "unreachable"}):`, err);

    if (isWrite) {
      if (timedOut) {
        throw new ApiOutcomeUnknownError(
          `The server did not respond within ${timeoutMs / 1000}s. Your change may or may not have been saved.`
        );
      }
      throw new Error("We couldn't reach the server, so nothing was saved. Please try again in a moment.");
    }

    // A read that gets no answer almost always means the API is asleep (free hosting
    // pauses idle services) or restarting. Send the user to a page that waits for it
    // and brings them back, instead of a crash screen.
    let returnTo = "/orgs";
    try {
      returnTo = (await headers()).get("x-pathname") ?? returnTo;
    } catch {
      /* not inside a request */
    }
    redirect(`/waking-up?returnTo=${encodeURIComponent(returnTo)}`);
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
