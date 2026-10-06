"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LoadingOverlay } from "@/components/ui/loading-overlay";
import { AuthLayout } from "@/components/layout/auth-layout";

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
    <AuthLayout title="Sign in" subtitle="Welcome back." footer={
      <>
        Don&apos;t have an account?{" "}
          <Link href="/signup" className="btn-link">
            Sign up
          </Link>
      </>
    }>
      <LoadingOverlay show={loading} label="Signing in…" />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="field-label">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full input-field"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="field-label">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full input-field"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="alert-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
    </AuthLayout>
  );
}
