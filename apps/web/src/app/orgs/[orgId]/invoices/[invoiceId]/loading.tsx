import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Skeleton className="mb-2 h-6 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="mb-6 h-20 w-full" />
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-6 h-32 w-full" />
      <Skeleton className="mb-2 h-4 w-20" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
