import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium tracking-normal outline-none transition-all duration-200 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/25",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset,0_12px_28px_rgba(37,211,102,0.16)] hover:bg-primary/90 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_16px_36px_rgba(37,211,102,0.2)] active:translate-y-px",
        destructive:
          "bg-destructive text-white shadow-[0_10px_28px_rgba(255,95,87,0.16)] hover:bg-destructive/90 focus-visible:ring-destructive/30 active:translate-y-px",
        outline:
          "border border-border/80 bg-surface-elevated/45 text-foreground shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] hover:border-border hover:bg-surface-elevated hover:text-foreground active:translate-y-px",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:translate-y-px",
        ghost:
          "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        subtle: "bg-primary/10 text-primary hover:bg-primary/15 active:translate-y-px",
        glass: "border border-white/10 bg-white/[0.04] text-foreground backdrop-blur hover:bg-white/[0.07]",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-10 px-5 has-[>svg]:px-4",
        xl: "h-11 px-6 has-[>svg]:px-5",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
