import * as React from "react";

import { cn } from "./utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content flex min-h-20 w-full resize-none rounded-md border border-input/85 bg-input-background px-3 py-2 text-base text-foreground shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/75 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "hover:border-border focus-visible:border-ring focus-visible:bg-surface-elevated focus-visible:ring-[3px] focus-visible:ring-ring/30",
        "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/25",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
