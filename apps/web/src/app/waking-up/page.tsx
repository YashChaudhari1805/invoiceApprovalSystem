"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SignOutLink } from "@/components/layout/sign-out-link";

const POLL_MS = 3000;
const GIVE_UP_AFTER_S = 150;

// Only ever return to a path inside this app.
function safeReturnTo(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/orgs";
}

function WakingUp() {
  const router = useRouter();
  const returnTo = safeReturnTo(useSearchParams().get("returnTo"));
  const [elapsed, setElapsed] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const stopped = useRef(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/wake", { cache: "no-store" });
      const { ok } = (await res.json()) as { ok: boolean };
      if (ok && !stopped.current) {
        stopped.current = true;
        router.replace(returnTo);
        router.refresh();
        return true;
      }
    } catch {
      /* network blip: keep trying */
    }
    return false;
  }, [router, returnTo]);

  useEffect(() => {
    stopped.current = false;
    let cancelled = false;
    const startedAt = Date.now();

    async function loop() {
      while (!cancelled && !stopped.current) {
        if (await check()) return;
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        if (seconds >= GIVE_UP_AFTER_S) {
          setGaveUp(true);
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
    void loop();

    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [check]);

  function retry() {
    setGaveUp(false);
    setElapsed(0);
    window.location.reload();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-[var(--page-gutter)]">
      <div className="card-raised w-full max-w-md p-8 text-center">
        {!gaveUp ? (
          <>
            <div
              className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-2 border-ink-100 border-t-accent-600"
              role="status"
              aria-label="Loading"
            />
            <h1 className="font-heading text-xl font-semibold text-ink-950">The server is starting up</h1>
            <p className="mt-2 text-sm text-ink-500">
              This app runs on free hosting that pauses when it is not used. Waking it takes up to a minute. You will be
              taken to your page automatically, so there is nothing you need to do.
            </p>
            <p className="mt-4 text-xs text-ink-300 tabular-nums">Waiting {elapsed}s</p>
          </>
        ) : (
          <>
            <h1 className="font-heading text-xl font-semibold text-ink-950">Still can&apos;t reach the server</h1>
            <p className="mt-2 text-sm text-ink-500">
              It is taking longer than usual. Your data is safe. Check your internet connection, then try again. If this
              keeps happening, the service may be down for maintenance, so please try again in a few minutes.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button onClick={retry} className="btn-primary">
                Try again
              </button>
              <SignOutLink />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function WakingUpPage() {
  return (
    <Suspense>
      <WakingUp />
    </Suspense>
  );
}
