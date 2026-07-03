import type { ComponentProps, ReactNode } from "react";

import { cn } from "./utils";

interface SectionHeaderProps extends ComponentProps<"div"> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

function SectionHeader({ title, description, actions, className, ...props }: SectionHeaderProps) {
  return (
    <div data-slot="section-header" className={cn("flex items-start justify-between gap-3", className)} {...props}>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export { SectionHeader };
