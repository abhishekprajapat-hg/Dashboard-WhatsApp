import type { ComponentProps, ReactNode } from "react";

import { Badge } from "./badge";
import { Card, CardContent } from "./card";
import { cn } from "./utils";

interface StatCardProps extends ComponentProps<typeof Card> {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  icon?: ReactNode;
  tone?: "primary" | "info" | "warning" | "muted";
}

const toneClass = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning",
  muted: "bg-secondary text-muted-foreground",
};

const toneBadgeVariant = {
  primary: "success",
  info: "info",
  warning: "warning",
  muted: "outline",
} as const;

function StatCard({ label, value, delta, icon, tone = "primary", className, ...props }: StatCardProps) {
  return (
    <Card data-slot="stat-card" className={cn("overflow-hidden", className)} {...props}>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <div className="mt-2 truncate text-2xl font-semibold leading-none text-foreground">{value}</div>
          {delta && (
            <Badge variant={toneBadgeVariant[tone]} className="mt-3">
              {delta}
            </Badge>
          )}
        </div>
        {icon && <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", toneClass[tone])}>{icon}</div>}
      </CardContent>
    </Card>
  );
}

export { StatCard };
