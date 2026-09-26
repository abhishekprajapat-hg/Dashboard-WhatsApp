import { Facebook, Instagram } from "lucide-react";
import type { Conversation } from "./types";
import { avatarTint, cn, initials } from "./utils";

const sizes = {
  sm: { box: "size-9 text-[12px]", badge: "size-4 [&_svg]:size-2.5" },
  md: { box: "size-10 text-[13px]", badge: "size-4 [&_svg]:size-2.5" },
  lg: { box: "size-16 text-lg", badge: "size-5 [&_svg]:size-3" },
};

/** Round initials avatar with a small channel mark for Instagram / Facebook chats. */
export function ContactAvatar({ name, channel, size = "md", className }: { name: string; channel?: Conversation["channel"]; size?: keyof typeof sizes; className?: string }) {
  const s = sizes[size];
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center rounded-full font-semibold", s.box, avatarTint(name), className)}>
      {initials(name) || "?"}
      {channel === "instagram" ? (
        <span className={cn("absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-card bg-[#c13584] text-white", s.badge)} aria-label="Instagram">
          <Instagram />
        </span>
      ) : channel === "facebook" ? (
        <span className={cn("absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-card bg-[#1877f2] text-white", s.badge)} aria-label="Facebook">
          <Facebook />
        </span>
      ) : null}
    </span>
  );
}
