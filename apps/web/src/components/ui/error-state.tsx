"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { SignOutLink } from "@/components/layout/sign-out-link";

/**
 * Shared body of every error boundary. In production Next.js replaces a server error's message
 * with a generic one, so this never shows `error.message`; it explains the usual causes instead.
 * "Try again" re-runs the server render (router.refresh) and then clears the boundary: calling
 * reset() alone only re-renders the client and would show the same failure again.
 */
export function ErrorState({
  title,
  digest,
  reset,
  showOrgsLink = false,
}: {
  title: string;
  digest?: string;
  reset: () => void;
  showOrgsLink?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-[var(--page-gutter)]">
      <div className="card-raised w-full max-w-md p-8 text-center">
        <h1 className="font-heading text-xl font-semibold text-ink-950">{title}</h1>
        <p className="mt-2 text-sm text-ink-500">
          This is usually temporary: the server may have been busy, or your connection dropped for a moment. Nothing you
          entered has been lost. Try again, and if it keeps happening, wait a minute or contact your administrator.
        </p>
        {digest && <p className="mt-3 text-xs text-ink-300">Reference for support: {digest}</p>}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button onClick={retry} disabled={pending} className="btn-primary">
            {pending ? "Trying again…" : "Try again"}
          </button>
          {showOrgsLink && (
            <Link href="/orgs" className="btn-quiet">
              Your organizations
            </Link>
          )}
          <SignOutLink />
        </div>
      </div>
    </main>
  );
}
