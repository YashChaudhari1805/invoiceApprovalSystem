"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SignOutLink } from "./sign-out-link";
import { ThemeToggle } from "./theme-toggle";
import { InvoicesIcon, ActivityIcon, MembersIcon } from "./icons";

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
    { href: `/orgs/${currentOrgId}/invoices`, label: "Invoices", Icon: InvoicesIcon },
    { href: `/orgs/${currentOrgId}/activity`, label: "Activity", Icon: ActivityIcon },
    ...(currentRole === "ADMIN" ? [{ href: `/orgs/${currentOrgId}/members`, label: "Members", Icon: MembersIcon }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop sidebar — hidden below md, where the bottom bar takes over. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-100 bg-surface md:flex">
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
                className={`nav-pill flex items-center gap-2.5 ${active ? "nav-pill-active" : "nav-pill-inactive"}`}
              >
                <item.Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-ink-100 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-ink-500">{userEmail}</p>
            <ThemeToggle />
          </div>
          <SignOutLink className="mt-1 text-xs font-medium text-ink-500 transition hover:text-accent-600" />
        </div>
      </aside>

      {/* Mobile top bar — org name + theme toggle + sign out, since there's
          no room for the full switcher/profile block from the desktop sidebar. */}
      <header className="flex items-center justify-between gap-2 border-b border-ink-100 bg-surface px-4 py-3 md:hidden">
        <span className="truncate font-heading text-sm font-semibold text-ink-950">
          {currentOrg?.name ?? "Select organization"}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <SignOutLink className="text-xs font-medium text-ink-500 transition hover:text-accent-600" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>

      {/* Mobile bottom bar — same three destinations as the desktop sidebar,
          reachable with a thumb instead of scrolled off the top of a tall page. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ink-100 bg-surface md:hidden">
        {navItems.map((item) => {
          const active = pathname?.startsWith(item.href.split("?")[0]);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition ${
                active ? "text-accent-500" : "text-ink-500"
              }`}
            >
              <item.Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
