import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium leading-[1.35rem] tracking-[0.005em] transition-[color,box-shadow,background-color,border-color] [&>svg]:size-3 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/25",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-problem-soft text-destructive [a&]:hover:bg-destructive/15 focus-visible:ring-destructive/30",
        outline:
          "border-border bg-card text-muted-foreground [a&]:hover:bg-secondary [a&]:hover:text-foreground",
        success:
          "border-transparent bg-success/12 text-success [a&]:hover:bg-success/18",
        info:
          "border-transparent bg-jewel-soft text-primary [a&]:hover:bg-primary/15",
        warning:
          "border-transparent bg-warning/12 text-warning [a&]:hover:bg-warning/18",
        money:
          "border-transparent bg-money-soft text-money [a&]:hover:bg-money/18",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
