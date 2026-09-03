import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-wash-radial px-4">
      <div className="w-full max-w-md">
        <Skeleton className="mb-2 h-6 w-40" />
        <Skeleton className="mb-6 h-4 w-48" />
        <div className="space-y-px overflow-hidden rounded-lg border border-ink-100 bg-white">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
