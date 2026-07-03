import { useEffect, useState } from "react";
import { Activity, BriefcaseBusiness, CalendarClock, CircleUserRound, Edit3, Flag, Megaphone, Tag, UserRoundCheck } from "lucide-react";
import type { Conversation, TeamMember } from "./types";
import { conversationMeta, initials } from "./utils";

interface CustomerProfileSidebarProps {
  conversation: Conversation;
  members: TeamMember[];
  savingCrm: boolean;
  assigning: boolean;
  onAssign: (userId: string) => void;
  onStatusChange: (status: Conversation["status"]) => void;
  onConversationSetting: (settings: { pinned?: boolean; muted?: boolean }) => void;
  onAddToCrm: (stage?: string) => void;
}

const leadStages = [
  { id: "new_lead", label: "New lead" },
  { id: "contacted", label: "Contacted" },
  { id: "qualified", label: "Qualified" },
  { id: "proposal_sent", label: "Proposal sent" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export function CustomerProfileSidebar({
  conversation,
  members,
  savingCrm,
  assigning,
  onAssign,
  onStatusChange,
  onConversationSetting,
  onAddToCrm,
}: CustomerProfileSidebarProps) {
  const meta = conversationMeta(conversation);
  const [leadStage, setLeadStage] = useState(meta.crmStage === "lead" ? "new_lead" : meta.crmStage || "new_lead");
  useEffect(() => {
    setLeadStage(meta.crmStage === "lead" ? "new_lead" : meta.crmStage || "new_lead");
  }, [conversation.id, meta.crmStage]);
  const customFields = [
    ["Phone", conversation.phone],
    ["Source", conversation.source || "WhatsApp"],
    ["Campaign", meta.campaign],
    ["Last seen", meta.lastSeen],
  ];

  return (
    <aside className="hidden w-[336px] shrink-0 flex-col border-l border-border/80 bg-card/75 backdrop-blur-xl xl:flex">
      <div className="border-b border-border/80 p-5 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-teal-700 text-xl font-semibold text-primary-foreground shadow-[0_18px_42px_rgba(37,211,102,0.16)]">
          {initials(conversation.name)}
        </div>
        <div className="mt-3 text-base font-semibold text-foreground">{conversation.name}</div>
        <div className="text-xs text-muted-foreground">{conversation.phone}</div>
        <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium capitalize text-primary">
          <CircleUserRound size={13} />
          {conversation.status}
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <Tag size={14} /> Tags
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(conversation.tags.length ? conversation.tags : ["New"]).map((tag) => (
              <span key={tag} className="rounded-full border border-border bg-secondary/70 px-2 py-1 text-xs text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <BriefcaseBusiness size={14} /> CRM
          </h3>
          <div className="space-y-2 rounded-lg border border-border/80 bg-surface-subtle/55 p-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Lead stage</span>
              <span className="font-medium capitalize text-foreground">{meta.crmStage}</span>
            </div>
            <select
              value={leadStage}
              onChange={(event) => setLeadStage(event.target.value)}
              className="mt-2 h-8 w-full rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              {leadStages.map((stage) => (
                <option key={stage.id} value={stage.id}>{stage.label}</option>
              ))}
            </select>
            <div className="mt-2 rounded-md border border-border/60 bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground">
              Sheet sync: {conversation.syncStatus?.googleSheet?.status || "pending"}
            </div>
            <button className="mt-2 h-8 w-full rounded-md bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60" onClick={() => onAddToCrm(leadStage)} disabled={savingCrm}>
              {savingCrm ? "Saving..." : meta.isInCrm ? "Update lead" : "Mark as lead"}
            </button>
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <UserRoundCheck size={14} /> Assigned Agent
          </h3>
          <select
            value={conversation.agentId || ""}
            disabled={assigning}
            onChange={(event) => onAssign(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-input-background px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <Flag size={14} /> Conversation
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {(["open", "waiting", "resolved", "archived"] as const).map((status) => (
              <button key={status} className="h-8 rounded-md border border-border text-xs capitalize text-muted-foreground hover:border-primary/40 hover:text-primary" onClick={() => onStatusChange(status)}>
                {status}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="h-8 rounded-md border border-border text-xs text-muted-foreground hover:border-primary/40 hover:text-primary" onClick={() => onConversationSetting({ pinned: !conversation.pinned })}>
              {conversation.pinned ? "Unpin" : "Pin"}
            </button>
            <button className="h-8 rounded-md border border-border text-xs text-muted-foreground hover:border-primary/40 hover:text-primary" onClick={() => onConversationSetting({ muted: !conversation.muted })}>
              {conversation.muted ? "Unmute" : "Mute"}
            </button>
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <Edit3 size={14} /> Notes
          </h3>
          <div className="rounded-lg border border-dashed border-border p-3 text-xs leading-relaxed text-muted-foreground">
            {conversation.messages.find((message) => message.internal)?.content || "No internal notes yet."}
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <Activity size={14} /> Activity Timeline
          </h3>
          <div className="space-y-3">
            {[
              { icon: CalendarClock, label: `Last message ${conversation.time}` },
              { icon: Megaphone, label: `Source ${conversation.source || "WhatsApp"}` },
              { icon: UserRoundCheck, label: `Assigned to ${conversation.agent || "Unassigned"}` },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex gap-2 text-xs text-muted-foreground">
                  <Icon size={14} className="mt-0.5 shrink-0 text-primary" />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Custom Fields</h3>
          <div className="space-y-2">
            {customFields.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="max-w-[160px] text-right text-foreground">{value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
