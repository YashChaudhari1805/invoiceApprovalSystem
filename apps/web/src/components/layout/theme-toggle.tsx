"use client";

import { useState } from "react";
import { useIsClient } from "@/hooks/use-is-client";
import { SunIcon, MoonIcon } from "@/components/ui/icons";

export const THEME_STORAGE_KEY = "invoice-app-theme";

/**
 * Light/dark toggle. Light is the app's default (see the inline boot script
 * in app/layout.tsx, and :root in globals.css having no selector guard) —
 * this only ever needs to add or remove data-theme="dark" on <html>, and
 * remember the choice in localStorage so it survives a reload/next visit.
 */
export function ThemeToggle({ className }: { className?: string }) {
  // null until the effect below reads the attribute the boot script already
  // set — avoids this button briefly showing the wrong icon (sun vs moon)
  // for one frame before hydration catches up.
  // The boot script in app/layout.tsx has already set data-theme before hydration.
  // `override` holds a choice made after load; before the client is ready, render a placeholder.
  const isClient = useIsClient();
  const [override, setTheme] = useState<"dark" | "light" | null>(null);
  const theme: "dark" | "light" | null =
    override ?? (isClient ? (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light") : null);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme"); // absence = light, the :root default
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private-browsing / storage-blocked contexts can throw here. The
      // toggle still works for the rest of this session — it just won't be
      // remembered on the next visit.
    }
  }

  if (theme === null) return <span className={className} aria-hidden />;

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={className ?? "rounded-full p-1.5 text-ink-500 transition hover:bg-ink-50 hover:text-ink-900"}
    >
      {theme === "dark" ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}
