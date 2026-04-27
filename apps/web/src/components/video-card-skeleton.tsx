import { Skeleton } from "@video-site/ui/components/skeleton";

export function VideoCardSkeleton() {
  return (
    <div className="block">
      <Skeleton className="aspect-video w-full" />
      <div className="mt-3 min-w-0 space-y-2">
        <Skeleton className="h-4 w-[90%]" />
        <Skeleton className="h-3 w-[60%]" />
        <Skeleton className="h-3 w-[40%]" />
      </div>
    </div>
  );
}

export function VideoGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <VideoCardSkeleton key={i} />
      ))}
    </div>
  );
}
