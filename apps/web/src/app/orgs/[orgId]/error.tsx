"use client";

import { useEffect } from "react";
import { SignOutLink } from "@/components/sign-out-link";

/**
 * Next.js error boundary for everything under /orgs/[orgId] — the layout
 * (which fetches session + org membership) and every page beneath it
 * (invoices, invoice detail, members, activity). Without this file, any
 * unhandled throw in that subtree — most commonly apiFetch failing because
 * the API is unreachable, mid-deploy, or waking from a cold start on a
 * free-tier host — renders Next's generic "Application error: a
 * server-side exception has occurred" with a bare digest number and
 * nothing else. That's a dead end for a real user: no explanation, no way
 * back, nothing to click.
 *
 * This can't fix *why* a request failed (see apiFetch's own error
 * messages for that — they're deliberately specific: timeout vs
 * unreachable vs non-2xx), but it turns an unrecoverable crash into a
 * retryable one, which is the actual thing a user in this situation needs.
 */
export default function OrgError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server-side exceptions are already logged where the throw happened;
    // this just keeps the client-side console non-empty too, since that's
    // the first place most people look when told "something went wrong".
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="font-heading text-lg font-semibold text-ink-950">Something went wrong loading this page</h1>
        <p className="mt-2 text-sm text-ink-500">
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest && <p className="mt-1 text-xs text-ink-300">Reference: {error.digest}</p>}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button onClick={reset} className="btn-primary">
            Try again
          </button>
          <SignOutLink />
        </div>
      </div>
    </div>
  );
}
