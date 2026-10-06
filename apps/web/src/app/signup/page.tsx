"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LoadingOverlay } from "@/components/ui/loading-overlay";
import { AuthLayout } from "@/components/layout/auth-layout";

export default function SignupPage() {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [confirmationPending, setConfirmationPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      window.location.href = "/orgs";
      return;
    }

    setConfirmationPending(true);
    setLoading(false);
  }

  if (confirmationPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-ink-950">
            Check your email
          </h1>
          <p className="mb-6 text-sm text-ink-500">
            We sent a confirmation link to <span className="font-medium text-ink-700">{email}</span>.
            Click it, then come back and sign in.
          </p>
          <Link href="/login" className="text-sm btn-link">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AuthLayout title="Create account" subtitle="Set up your login." footer={
      <>
        Already have an account?{" "}
          <Link href="/login" className="btn-link">
            Sign in
          </Link>
      </>
    }>
      <LoadingOverlay show={loading} label="Creating account…" />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="field-label">
              Full name
            </label>
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full input-field"
              placeholder="Jane Doe"
            />
          </div>

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
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full input-field"
              placeholder="At least 6 characters"
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
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-ink-500">
          Creating an account doesn&apos;t add you to any organization yet — an Admin
          still needs to add you by email from their Members screen.
        </p>
    </AuthLayout>
  );
}
