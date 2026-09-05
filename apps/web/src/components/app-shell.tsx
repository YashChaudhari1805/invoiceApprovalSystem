"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SignOutLink } from "./sign-out-link";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export function AppShell({
  orgs,
  currentOrgId,
  currentRole,
  userEmail,
  children,
}: {
  orgs: Org[];
  currentOrgId: string;
  currentRole: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const currentOrg = orgs.find((o) => o.id === currentOrgId);

  const navItems = [
    { href: `/orgs/${currentOrgId}/invoices`, label: "Invoices" },
    { href: `/orgs/${currentOrgId}/activity`, label: "Activity" },
    ...(currentRole === "ADMIN" ? [{ href: `/orgs/${currentOrgId}/members`, label: "Members" }] : []),
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-100 bg-surface">
        <div className="border-b border-ink-100 px-5 py-5">
          <div className="relative">
            <button
              onClick={() => setSwitcherOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-full px-3 py-1.5 text-left transition hover:bg-ink-50"
            >
              <span className="truncate font-heading text-sm font-semibold text-ink-950">
                {currentOrg?.name ?? "Select organization"}
              </span>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className="shrink-0 text-ink-500">
                <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {switcherOpen && (
              <div className="dropdown-panel">
                {orgs.map((org) => (
                  <Link
                    key={org.id}
                    href={`/orgs/${org.id}/invoices`}
                    onClick={() => setSwitcherOpen(false)}
                    className={`dropdown-item ${
                      org.id === currentOrgId ? "text-accent-500" : "text-ink-700"
                    }`}
                  >
                    <span className="truncate">{org.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-ink-300">{org.role}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {navItems.map((item) => {
            const active = pathname?.startsWith(item.href.split("?")[0]);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-pill ${active ? "nav-pill-active" : "nav-pill-inactive"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-ink-100 px-5 py-4">
          <p className="truncate text-xs text-ink-500">{userEmail}</p>
          <SignOutLink className="mt-1 text-xs font-medium text-ink-500 transition hover:text-accent-600" />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
