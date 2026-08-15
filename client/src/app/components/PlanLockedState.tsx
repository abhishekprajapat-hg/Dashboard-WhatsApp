import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";

// Shared "this workspace's plan doesn't include this" state, driven by the server's real
// PLAN_LIMIT error (server/middleware/auth.js's requireEntitlement) - not a client-side guess at
// what's locked, the message text comes straight from the same check that actually blocks the API.
export function PlanLockedState({
  title,
  message,
  icon,
}: {
  title: string;
  message: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="rounded-lg border-dashed border-border/70 bg-card/60">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {icon ?? <Lock size={20} />}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          Ask an admin to upgrade this workspace's plan
        </Badge>
      </CardContent>
    </Card>
  );
}

export function isPlanLimitError(error: unknown): error is Error & { code: "PLAN_LIMIT"; message: string } {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "PLAN_LIMIT");
}
