"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "REVIEW", label: "In review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

// Invoice-number search only starts firing automatically once the user has
// typed at least this many characters (per spec) — below that it would
// re-fetch on every keystroke for a query too short to narrow anything down.
// Pressing Enter always searches immediately regardless of length.
const SEARCH_MIN_LENGTH = 4;
const DEBOUNCE_MS = 350;

export function InvoiceFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlSearch = searchParams.get("search") ?? "";
  const urlVendor = searchParams.get("vendor") ?? "";
  const urlStatus = searchParams.get("status") ?? "";

  const [search, setSearch] = useState(urlSearch);
  const [vendor, setVendor] = useState(urlVendor);

  // If the URL changes from somewhere other than this component — browser
  // back/forward, a shared link, the pagination controls resetting page —
  // keep the inputs in sync with it instead of showing stale local state.
  useEffect(() => setSearch(urlSearch), [urlSearch]);
  useEffect(() => setVendor(urlVendor), [urlVendor]);

  function pushParams(next: Partial<Record<"search" | "vendor" | "status", string>>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.set("page", "1"); // any filter change resets to page 1
    router.push(`${pathname}?${params.toString()}`);
  }

  // Live filtering: re-query DEBOUNCE_MS after the user stops typing in
  // either box, so search and vendor changes made close together land in a
  // single navigation instead of racing each other. Search is additionally
  // held back until it's empty (cleared) or has reached the minimum length.
  useEffect(() => {
    const searchChanged = search !== urlSearch;
    const vendorChanged = vendor !== urlVendor;
    if (!searchChanged && !vendorChanged) return;
    if (search.length > 0 && search.length < SEARCH_MIN_LENGTH) return;

    const timeout = setTimeout(() => pushParams({ search, vendor }), DEBOUNCE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, vendor]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    pushParams({ search, vendor }); // Enter searches immediately, any length
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form onSubmit={handleSearchSubmit} className="flex items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice number… (min 4 characters)"
          aria-label="Search invoice number"
          className="w-56 input-field"
        />
      </form>

      <input
        value={vendor}
        onChange={(e) => setVendor(e.target.value)}
        placeholder="Filter by vendor…"
        aria-label="Filter by vendor"
        className="w-48 input-field"
      />

      <select
        value={urlStatus}
        onChange={(e) => pushParams({ search, vendor, status: e.target.value })}
        aria-label="Filter by status"
        className="input-field"
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
