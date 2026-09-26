import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  ContactRound,
  FileStack,
  FileText,
  Headset,
  Inbox,
  ListChecks,
  Megaphone,
  Receipt,
  Settings,
  ShieldCheck,
  Sparkle,
  Target,
  TrendingUp,
  Truck,
  Users2,
  Zap,
} from "lucide-react";

// Every screen in the app. The ids are the #hash routes and stay stable (links and saved views use
// them); only labels and grouping are presentation.
export type ViewId =
  | "dashboard"
  | "inbox"
  | "contacts"
  | "leads"
  | "automation"
  | "templates"
  | "campaigns"
  | "analytics"
  | "marketing"
  | "invoicing"
  | "shipping"
  | "documents"
  | "support"
  | "team"
  | "tasks"
  | "admin"
  | "assistant"
  | "settings";

export type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  /** Short line for the command palette and tooltips. */
  hint: string;
  /** "g" then this key jumps here (shown in the palette and the shortcuts sheet). */
  key?: string;
};

export type NavGroup = { label: string; items: NavItem[] };

// Grouped by the job each screen does, ordered by how often people use it (Dashboard Makeover
// Plan, section 04). Nothing is removed; permissions still decide what each person sees.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Home",
    items: [
      { id: "dashboard", label: "Today", icon: Sparkle, hint: "What needs you today", key: "d" },
      { id: "assistant", label: "AI Assistant", icon: Bot, hint: "AI tools and conversation insights", key: "a" },
    ],
  },
  {
    label: "Conversations",
    items: [
      { id: "inbox", label: "Inbox", icon: Inbox, hint: "WhatsApp, Instagram and Facebook chats", key: "i" },
      { id: "templates", label: "Templates", icon: FileText, hint: "Approved message templates", key: "t" },
      { id: "campaigns", label: "Campaigns", icon: Megaphone, hint: "Broadcasts and audience sends", key: "b" },
    ],
  },
  {
    label: "Customers",
    items: [
      { id: "contacts", label: "CRM", icon: ContactRound, hint: "Customer records and lifecycle", key: "c" },
      { id: "leads", label: "Pipeline", icon: Target, hint: "Every lead, stage by stage", key: "p" },
      { id: "tasks", label: "Tasks", icon: ListChecks, hint: "Tasks and calendar for your team", key: "k" },
    ],
  },
  {
    label: "Automate",
    items: [{ id: "automation", label: "Automation", icon: Zap, hint: "Flows, triggers and routing", key: "f" }],
  },
  {
    label: "Money",
    items: [
      { id: "invoicing", label: "Invoicing", icon: Receipt, hint: "Invoices and payments", key: "v" },
      { id: "shipping", label: "Shipping", icon: Truck, hint: "Order dispatch tracking", key: "s" },
    ],
  },
  {
    label: "Grow and run",
    items: [
      { id: "marketing", label: "Marketing", icon: TrendingUp, hint: "Google Analytics, SEO and growth ideas", key: "m" },
      { id: "analytics", label: "Analytics", icon: BarChart3, hint: "Reports and performance", key: "r" },
      { id: "team", label: "Team", icon: Users2, hint: "Members, roles and workload", key: "e" },
      { id: "documents", label: "Documents", icon: FileStack, hint: "AI-drafted proposals" },
      { id: "support", label: "Support", icon: Headset, hint: "Support tickets from your inbox" },
      { id: "admin", label: "Admin", icon: ShieldCheck, hint: "Platform controls" },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { id: "settings", label: "Settings", icon: Settings, hint: "Workspace and integrations", key: "," };

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

export const VIEW_META: Record<ViewId, { label: string; hint: string }> = Object.fromEntries(
  ALL_NAV_ITEMS.map((item) => [item.id, { label: item.label, hint: item.hint }]),
) as Record<ViewId, { label: string; hint: string }>;

// Phone tab bar: the five things field staff use most. "More" opens the full grouped menu.
export const MOBILE_TABS: ViewId[] = ["dashboard", "inbox", "leads", "tasks"];
