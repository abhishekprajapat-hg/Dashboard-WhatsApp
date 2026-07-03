import type { ComponentProps } from "react";

import { Skeleton } from "./skeleton";
import { cn } from "./utils";

interface LoadingSkeletonProps extends ComponentProps<"div"> {
  rows?: number;
  showHeader?: boolean;
}

function LoadingSkeleton({ rows = 4, showHeader = true, className, ...props }: LoadingSkeletonProps) {
  return (
    <div data-slot="loading-skeleton" className={cn("space-y-3", className)} {...props}>
      {showHeader && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      )}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

export { LoadingSkeleton };
