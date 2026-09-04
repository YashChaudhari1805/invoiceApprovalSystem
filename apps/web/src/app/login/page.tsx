"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // A hard navigation (not router.push) after sign-in, so the very next
    // page load is a real request carrying the new session cookie — never
    // served from Next's client-side Router Cache, which could otherwise
    // reuse a previous user's cached page for the same URL in this tab.
    window.location.href = "/orgs";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-wash-radial px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 font-heading text-2xl font-semibold tracking-tight text-ink-950">
          Sign in
        </h1>
        <p className="mb-8 text-sm text-ink-500">Invoice Approval System</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-ink-100 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-ink-100 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-accent-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-700 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}