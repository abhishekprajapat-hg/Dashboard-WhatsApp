import { LOGO_PATH, LOGO_VIEWBOX } from "./logo-path";
import { cn } from "../ui/utils";

/** The Nemnidhi spiral mark (same master as nemnidhi.com). Inherits colour via currentColor. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={cn("size-6", className)} aria-hidden="true">
      <path d={LOGO_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
