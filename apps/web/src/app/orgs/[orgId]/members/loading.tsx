import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Skeleton className="mb-2 h-6 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="overflow-hidden card">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-ink-100 px-4 py-3.5 last:border-0">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-7 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
