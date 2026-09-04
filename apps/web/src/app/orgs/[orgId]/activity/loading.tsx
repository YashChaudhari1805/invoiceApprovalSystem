import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <Skeleton className="mb-6 h-6 w-24" />
      <div className="overflow-hidden rounded-lg border border-ink-100 bg-white">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between border-b border-ink-100 px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
