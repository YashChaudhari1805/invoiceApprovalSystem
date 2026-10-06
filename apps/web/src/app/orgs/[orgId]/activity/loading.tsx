import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="page page-narrow">
      <Skeleton className="mb-6 h-6 w-24" />
      <div className="overflow-hidden card">
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
