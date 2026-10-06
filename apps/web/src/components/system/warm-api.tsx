"use client";

import { useEffect } from "react";

/** Starts waking a sleeping API as soon as the sign-in page opens, so it is ready by the time credentials are submitted. */
export function WarmApi() {
  useEffect(() => {
    fetch("/api/wake", { cache: "no-store" }).catch(() => {});
  }, []);
  return null;
}
