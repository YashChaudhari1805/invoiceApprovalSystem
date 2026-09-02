"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function goTo(targetPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(targetPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3">
      <p className="text-xs text-ink-500">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => goTo(page - 1)}
          disabled={page <= 1}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Previous
        </button>
        <span className="px-2 text-xs text-ink-500">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => goTo(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Next
        </button>
      </div>
    </div>
  );
}
