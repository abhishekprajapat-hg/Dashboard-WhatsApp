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
  onAddToCrm: () => void;
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
}: CustomerProfileSidebarProps) {
  const meta = conversationMeta(conversation);
  const customFields = [
    ["Phone", conversation.phone],
    ["Source", conversation.source || "WhatsApp"],
    ["Campaign", meta.campaign],
    ["Last seen", meta.lastSeen],
  ];

  return (
    <aside className="hidden w-[320px] shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111b21] xl:flex">
      <div className="border-b border-zinc-200 p-5 text-center dark:border-zinc-800">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-xl font-semibold text-white shadow-sm">
          {initials(conversation.name)}
        </div>
        <div className="mt-3 text-base font-semibold text-zinc-950 dark:text-zinc-50">{conversation.name}</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{conversation.phone}</div>
        <div className="mt-3 inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-xs font-medium capitalize text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CircleUserRound size={13} />
          {conversation.status}
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-zinc-400">
            <Tag size={14} /> Tags
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(conversation.tags.length ? conversation.tags : ["New"]).map((tag) => (
              <span key={tag} className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-[#202c33] dark:text-zinc-300">
                {tag}
              </span>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-zinc-400">
            <BriefcaseBusiness size={14} /> CRM
          </h3>
          <div className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">Lead stage</span>
              <span className="font-medium capitalize text-zinc-900 dark:text-zinc-100">{meta.crmStage}</span>
            </div>
            <button className="mt-2 h-8 w-full rounded bg-emerald-500 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-60" onClick={onAddToCrm} disabled={savingCrm || meta.isInCrm}>
              {meta.isInCrm ? "Saved in CRM" : savingCrm ? "Saving..." : "Add to CRM"}
            </button>
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-zinc-400">
            <UserRoundCheck size={14} /> Assigned Agent
          </h3>
          <select
            value={conversation.agentId || ""}
            disabled={assigning}
            onChange={(event) => onAssign(event.target.value)}
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none dark:border-zinc-800 dark:bg-[#202c33] dark:text-zinc-100"
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
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-zinc-400">
            <Flag size={14} /> Conversation
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {(["open", "waiting", "resolved", "archived"] as const).map((status) => (
              <button key={status} className="h-8 rounded border border-zinc-200 text-xs capitalize text-zinc-700 hover:border-emerald-400 hover:text-emerald-700 dark:border-zinc-800 dark:text-zinc-300" onClick={() => onStatusChange(status)}>
                {status}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="h-8 rounded border border-zinc-200 text-xs text-zinc-700 hover:border-emerald-400 hover:text-emerald-700 dark:border-zinc-800 dark:text-zinc-300" onClick={() => onConversationSetting({ pinned: !conversation.pinned })}>
              {conversation.pinned ? "Unpin" : "Pin"}
            </button>
            <button className="h-8 rounded border border-zinc-200 text-xs text-zinc-700 hover:border-emerald-400 hover:text-emerald-700 dark:border-zinc-800 dark:text-zinc-300" onClick={() => onConversationSetting({ muted: !conversation.muted })}>
              {conversation.muted ? "Unmute" : "Mute"}
            </button>
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-zinc-400">
            <Edit3 size={14} /> Notes
          </h3>
          <div className="rounded-md border border-dashed border-zinc-200 p-3 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {conversation.messages.find((message) => message.internal)?.content || "No internal notes yet."}
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-zinc-400">
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
                <div key={item.label} className="flex gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <Icon size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-400">Custom Fields</h3>
          <div className="space-y-2">
            {customFields.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
                <span className="max-w-[160px] text-right text-zinc-900 dark:text-zinc-100">{value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
