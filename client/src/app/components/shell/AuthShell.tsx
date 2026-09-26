import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";

const POINTS = [
  "WhatsApp, Instagram and Facebook chats in one inbox",
  "Every lead, follow-up and payment in one place",
  "Automations that reply while your team sleeps",
];

/**
 * Sign-in / sign-up frame: the Nacre brand panel on wide screens (pearl ground, the Nemnidhi spiral
 * opening upward and turning clockwise) and a single calm card for the form. Phones get just the
 * card with the mark above it.
 */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full min-w-0 overflow-x-hidden bg-background text-foreground">
      <section className="relative hidden min-h-dvh w-[46%] flex-col justify-between overflow-hidden border-r border-border bg-card p-10 lg:flex xl:p-14">
        <BrandMark className="pointer-events-none absolute -bottom-24 -right-24 size-[440px] text-primary/[0.06]" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BrandMark className="size-6" />
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">Nemnidhi</div>
            <div className="text-[12.5px] text-muted-foreground">Dashboard</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-serif text-[44px] leading-[1.05] tracking-[-0.01em] text-foreground xl:text-[52px]">
            Every customer conversation, <span className="text-primary">in one calm place.</span>
          </h1>
          <ul className="mt-8 grid gap-3">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[14.5px] text-muted-foreground">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-money" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[12px] text-muted-foreground">Made in India for Indian businesses.</p>
      </section>

      <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:px-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BrandMark className="size-5" />
            </span>
            <span className="text-[15px] font-semibold">Nemnidhi</span>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-float sm:p-8">{children}</div>
          {footer}
        </div>
      </main>
    </div>
  );
}
