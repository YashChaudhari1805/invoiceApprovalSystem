"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/** Boundary for the organization layout and every page beneath it (invoices, members, activity). */
export default function OrgError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <ErrorState title="We couldn't load this page" digest={error.digest} reset={reset} showOrgsLink />;
}
