import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <Skeleton className="mb-6 h-6 w-32" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <Skeleton className="mb-2 mt-5 h-4 w-24" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="mt-5 h-9 w-32" />
    </div>
  );
}
