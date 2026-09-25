"use client";

import { useEffect } from "react";

/**
 * Catch-all error boundary for everything NOT already covered by
 * orgs/[orgId]/error.tsx — /login, /orgs (the org selector), /signup. Same
 * reasoning as that file: turn an unhandled server-side throw into
 * something a user can retry instead of Next's bare digest page.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="font-heading text-lg font-semibold text-ink-950">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-500">{error.message || "An unexpected error occurred."}</p>
        {error.digest && <p className="mt-1 text-xs text-ink-300">Reference: {error.digest}</p>}
        <button onClick={reset} className="mt-5 btn-primary">
          Try again
        </button>
      </div>
    </div>
  );
}
