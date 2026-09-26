import * as React from "react";

import { cn } from "./utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content flex min-h-20 w-full resize-none rounded-lg border border-input bg-input-background px-3 py-2 text-base text-foreground shadow-[0_1px_2px_rgba(16,18,22,0.04)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/75 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20",
        "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/25",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
