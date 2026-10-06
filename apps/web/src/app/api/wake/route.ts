import { NextResponse } from "next/server";
import { getApiUrl } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Pings the API's /health so a sleeping free-tier server starts waking up.
 * Called from the login page (before anyone is signed in) and polled by /waking-up.
 * Never throws: the answer is always { ok: boolean }.
 */
export async function GET() {
  try {
    const res = await fetch(`${getApiUrl()}/health`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    return NextResponse.json({ ok: res.ok });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
