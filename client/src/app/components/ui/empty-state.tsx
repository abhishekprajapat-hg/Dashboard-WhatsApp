import type { ComponentProps, ReactNode } from "react";

import { cn } from "./utils";

interface EmptyStateProps extends ComponentProps<"div"> {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

function EmptyState({ icon, title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex min-h-44 flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-surface-subtle/60 px-6 py-8 text-center",
        className,
      )}
      {...props}
    >
      {icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-md border border-border/80 bg-surface-elevated text-primary shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export { EmptyState };
