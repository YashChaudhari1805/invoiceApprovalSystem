"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/** Catch-all boundary for everything outside /orgs/[orgId]: /login, /signup, /orgs. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <ErrorState title="We couldn't load this page" digest={error.digest} reset={reset} />;
}
