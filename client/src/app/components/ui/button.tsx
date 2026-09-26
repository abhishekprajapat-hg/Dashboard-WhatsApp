import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium tracking-[-0.005em] outline-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/25",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_2px_rgba(16,18,22,0.14)] hover:bg-primary/90 active:translate-y-px",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(16,18,22,0.14)] hover:bg-destructive/90 focus-visible:ring-destructive/30 active:translate-y-px",
        outline:
          "border border-input bg-card text-foreground shadow-[0_1px_2px_rgba(16,18,22,0.05)] hover:border-foreground/25 hover:bg-secondary/60 active:translate-y-px",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70 active:translate-y-px",
        ghost:
          "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        subtle: "bg-jewel-soft text-primary hover:bg-primary/15 active:translate-y-px",
        glass: "border border-border bg-card/70 text-foreground backdrop-blur hover:bg-card",
      },
      size: {
        default: "h-9 px-3.5 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-md px-2.5 text-xs has-[>svg]:px-2",
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

// forwardRef so a Button can sit inside Radix triggers (PopoverTrigger / DropdownMenuTrigger asChild),
// which need a ref to position their content.
const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean;
    }
>(function Button({ className, variant, size, asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot : "button";

  return <Comp ref={ref} data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});

export { Button, buttonVariants };
