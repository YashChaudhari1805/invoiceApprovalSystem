/** Shared frame for sign-in and sign-up: a single centred form on the app canvas. */
export function AuthLayout({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-[var(--page-gutter)] py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 font-heading text-lg font-semibold text-ink-950">Invoice Approval</p>
        <div className="card-raised p-6 sm:p-8">
          <h1 className="font-heading text-2xl font-semibold text-ink-950">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-ink-500">{subtitle}</p>
          {children}
        </div>
        <p className="mt-6 text-center text-sm text-ink-500">{footer}</p>
      </div>
    </main>
  );
}
