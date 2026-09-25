"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "./icons";

export const THEME_STORAGE_KEY = "invoice-app-theme";

/**
 * Light/dark toggle. Dark is the app's default (see the inline boot script
 * in app/layout.tsx, and :root in globals.css having no selector guard) —
 * this only ever needs to add or remove data-theme="light" on <html>, and
 * remember the choice in localStorage so it survives a reload/next visit.
 */
export function ThemeToggle({ className }: { className?: string }) {
  // null until the effect below reads the attribute the boot script already
  // set — avoids this button briefly showing the wrong icon (sun vs moon)
  // for one frame before hydration catches up.
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme"); // absence = dark, the :root default
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
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      className={className ?? "rounded-full p-1.5 text-ink-500 transition hover:bg-ink-50 hover:text-ink-900"}
    >
      {theme === "light" ? <MoonIcon className="h-4 w-4" /> : <SunIcon className="h-4 w-4" />}
    </button>
  );
}
