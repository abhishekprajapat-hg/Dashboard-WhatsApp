import { useEffect, useState, type ReactNode } from "react";
import { Bell, BellOff, CalendarClock, Megaphone, Pin, PinOff, StickyNote, UserRoundCheck, X } from "lucide-react";
import type { Conversation, TeamMember } from "./types";
import { ContactAvatar } from "./ContactAvatar";
import { cn, conversationMeta } from "./utils";

interface CustomerProfileSidebarProps {
  conversation: Conversation;
  members: TeamMember[];
  savingCrm: boolean;
  assigning: boolean;
  onAssign: (userId: string) => void;
  onStatusChange: (status: Conversation["status"]) => void;
  onConversationSetting: (settings: { pinned?: boolean; muted?: boolean }) => void;
  onAddToCrm: (stage?: string) => void;
  onClose?: () => void;
}

const leadStages = [
  { id: "new_lead", label: "New lead" },
  { id: "contacted", label: "Contacted" },
  { id: "qualified", label: "Qualified" },
  { id: "proposal_sent", label: "Proposal sent" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const statuses: { id: Conversation["status"]; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "waiting", label: "Waiting" },
  { id: "resolved", label: "Resolved" },
  { id: "archived", label: "Archived" },
];

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-input-background px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60";

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-2 border-b border-border px-4 py-4", className)}>
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function prettyStage(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function CustomerProfileSidebar({
  conversation,
  members,
  savingCrm,
  assigning,
  onAssign,
  onStatusChange,
  onConversationSetting,
  onAddToCrm,
  onClose,
}: CustomerProfileSidebarProps) {
  const meta = conversationMeta(conversation);
  const [leadStage, setLeadStage] = useState(meta.crmStage === "lead" ? "new_lead" : meta.crmStage || "new_lead");
  useEffect(() => {
    setLeadStage(meta.crmStage === "lead" ? "new_lead" : meta.crmStage || "new_lead");
  }, [conversation.id, meta.crmStage]);

  // The workspace's own stage keys may not be in the default list; keep the current one selectable.
  const stageOptions = leadStages.some((s) => s.id === leadStage) ? leadStages : [...leadStages, { id: leadStage, label: prettyStage(leadStage) }];
  const latestNote = [...conversation.messages].reverse().find((message) => message.internal)?.content;
  const details: [string, string | undefined][] = [
    ["Phone", conversation.phone],
    ["Source", conversation.source || "WhatsApp"],
    ["Campaign", meta.campaign],
    ["Last seen", meta.lastSeen],
    ["Sheet sync", conversation.syncStatus?.googleSheet?.status || "pending"],
  ];

  return (
    <aside className="@container flex h-full w-full flex-col overflow-hidden border-l border-border bg-card">
      <div className="relative flex flex-col items-center border-b border-border px-4 pb-4 pt-6 text-center">
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close customer details" className="absolute right-2 top-2 rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X size={16} />
          </button>
        )}
        <ContactAvatar name={conversation.name} channel={conversation.channel} size="lg" />
        <div className="mt-3 text-[16px] font-semibold text-foreground">{conversation.name}</div>
        {conversation.phone && <div className="text-[12.5px] text-muted-foreground tabular-nums">{conversation.phone}</div>}
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {meta.isInCrm && <span className="rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">{prettyStage(meta.crmStage)}</span>}
          {(conversation.tags.length ? conversation.tags : []).slice(0, 4).map((tag) => (
            <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Owner">
          <select value={conversation.agentId || ""} disabled={assigning} onChange={(event) => onAssign(event.target.value)} aria-label="Assigned to" className={selectClass}>
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </Section>

        <Section title="Lead">
          <div className="flex flex-col gap-2 @[280px]:flex-row">
            <select value={leadStage} onChange={(event) => setLeadStage(event.target.value)} aria-label="Lead stage" className={selectClass}>
              {stageOptions.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="h-9 shrink-0 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              onClick={() => onAddToCrm(leadStage)}
              disabled={savingCrm}
            >
              {savingCrm ? "Saving…" : meta.isInCrm ? "Update" : "Mark as lead"}
            </button>
          </div>
        </Section>

        <Section title="Conversation">
          <div role="radiogroup" aria-label="Conversation status" className="grid grid-cols-2 gap-0.5 rounded-lg bg-secondary/70 p-0.5 @[300px]:grid-cols-4">
            {statuses.map((status) => {
              const active = conversation.status === status.id;
              return (
                <button
                  key={status.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cn("h-7 rounded-md text-[11.5px] font-medium transition-colors", active ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}
                  onClick={() => onStatusChange(status.id)}
                >
                  {status.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border text-[12.5px] text-foreground hover:bg-secondary"
              onClick={() => onConversationSetting({ pinned: !conversation.pinned })}
            >
              {conversation.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              {conversation.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border text-[12.5px] text-foreground hover:bg-secondary"
              onClick={() => onConversationSetting({ muted: !conversation.muted })}
            >
              {conversation.muted ? <Bell size={13} /> : <BellOff size={13} />}
              {conversation.muted ? "Unmute" : "Mute"}
            </button>
          </div>
        </Section>

        <Section title="Details">
          <dl className="grid gap-1.5 text-[12.5px]">
            {details.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="max-w-[60%] truncate text-right text-foreground">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Latest note">
          {latestNote ? (
            <p className="flex gap-2 rounded-lg bg-bubble-note px-2.5 py-2 text-[12.5px] leading-relaxed text-foreground">
              <StickyNote size={13} className="mt-0.5 shrink-0 text-warning" />
              <span className="line-clamp-4">{latestNote}</span>
            </p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">No internal notes yet. Switch the composer to "Internal note" to leave one.</p>
          )}
        </Section>

        <Section title="Activity" className="border-b-0">
          <ol className="grid gap-2.5">
            {[
              { icon: CalendarClock, label: `Last message ${conversation.time}` },
              { icon: Megaphone, label: `Came from ${conversation.source || "WhatsApp"}` },
              { icon: UserRoundCheck, label: conversation.agent ? `Assigned to ${conversation.agent}` : "Not assigned yet" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label} className="flex items-center gap-2.5 text-[12.5px] text-foreground">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <Icon size={12} />
                  </span>
                  {item.label}
                </li>
              );
            })}
          </ol>
        </Section>
      </div>
    </aside>
  );
}
