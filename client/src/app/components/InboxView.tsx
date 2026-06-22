import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  Search,
  Filter,
  ChevronDown,
  Paperclip,
  Send,
  MoreVertical,
  Phone,
  CheckCheck,
  Tag,
  User,
  UserPlus,
  CheckCircle2,
  RefreshCw,
  Plus,
  Smile,
} from "lucide-react";
import { addConversationToCrm, assignConversation, getConversationByContact, getConversations, getEventStreamUrl, getTeamMembers, getUnreadCount, markConversationRead, sendConversationMessage } from "../lib/api";
import { demoConversations } from "../lib/demoData";

interface Message {
  id: string;
  content: string;
  from: "contact" | "agent";
  time: string;
  status?: "sent" | "delivered" | "read" | "failed";
}

interface Conversation {
  id: string;
  name: string;
  phone: string;
  preview: string;
  time: string;
  unread: number;
  status: "open" | "waiting" | "resolved" | "bot";
  agent?: string;
  agentId?: string;
  tags: string[];
  source?: string;
  lifecycleStatus?: string;
  crmStage?: string;
  crmAddedAt?: string;
  messages: Message[];
}

interface TeamMember {
  id: string;
  userId: string;
  name: string;
  role: "admin" | "manager" | "agent";
  status: string;
}

const fallbackConversations = demoConversations as Conversation[];
const tabs = ["All", "Open", "Waiting", "Resolved", "Mine"];
const statusColor: Record<string, string> = {
  open: "bg-primary/20 text-primary border-primary/30",
  waiting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  resolved: "bg-secondary text-muted-foreground border-border",
  bot: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

function mergeConversation(items: Conversation[], incoming: Conversation) {
  const existing = items.find((conversation) => conversation.id === incoming.id);
  const mergedMessages = existing
    ? [
        ...existing.messages.filter((message) => {
          if (incoming.messages.some((incomingMessage) => incomingMessage.id === message.id)) return false;
          if (
            message.id.startsWith("local_") &&
            incoming.messages.some(
              (incomingMessage) => incomingMessage.from === message.from && incomingMessage.content === message.content
            )
          ) {
            return false;
          }
          return true;
        }),
        ...incoming.messages,
      ]
    : incoming.messages;

  const merged = {
    ...(existing || incoming),
    ...incoming,
    messages: mergedMessages,
  };

  return [merged, ...items.filter((conversation) => conversation.id !== incoming.id)];
}

interface InboxViewProps {
  openContactId?: string | null;
  currentUserId?: string;
  onUnreadCountChange?: (count: number) => void;
}

export function InboxView({ openContactId, currentUserId, onUnreadCountChange }: InboxViewProps) {
  const [activeTab, setActiveTab] = useState("All");
  const [conversations, setConversations] = useState<Conversation[]>(fallbackConversations);
  const [selectedId, setSelectedId] = useState(fallbackConversations[0]?.id || "");
  const [inputText, setInputText] = useState("");
  const [search, setSearch] = useState("");
  const [sendError, setSendError] = useState("");
  const [crmSaving, setCrmSaving] = useState(false);
  const [crmNotice, setCrmNotice] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    getConversations<{ data: Conversation[]; total: number }>()
      .then((response) => {
        setConversations(response.data);
        setSelectedId((current) => current || response.data[0]?.id || "");
      })
      .catch(() => setConversations(fallbackConversations));

    getTeamMembers<{ data: TeamMember[]; total: number }>()
      .then((response) => setMembers(response.data.filter((member) => member.userId)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const events = new EventSource(getEventStreamUrl());

    events.addEventListener("conversation", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { conversation: Conversation };
      setConversations((items) => mergeConversation(items, payload.conversation));
      getUnreadCount<{ unread: number }>()
        .then((response) => onUnreadCountChange?.(response.unread))
        .catch(() => undefined);
      setSelectedId((current) => current || payload.conversation.id);
    });

    return () => events.close();
  }, []);

  useEffect(() => {
    if (!openContactId) return;

    getConversationByContact<{ data: Conversation }>(openContactId)
      .then((response) => {
        setConversations((items) => mergeConversation(items, response.data));
        setSelectedId(response.data.id);
        setActiveTab("All");
      })
      .catch(() => undefined);
  }, [openContactId]);

  useEffect(() => {
    if (!selectedId) return;
    setCrmNotice("");

    markConversationRead<{ unread: number }>(selectedId)
      .then(() => {
        setConversations((items) =>
          items.map((conversation) => (conversation.id === selectedId ? { ...conversation, unread: 0 } : conversation))
        );
        return getUnreadCount<{ unread: number }>();
      })
      .then((response) => onUnreadCountChange?.(response.unread))
      .catch(() => undefined);
  }, [selectedId, onUnreadCountChange]);

  const selected = conversations.find((c) => c.id === selectedId) || conversations[0];
  const filtered = conversations.filter((conversation) => {
    const matchTab =
      activeTab === "All" ||
      (activeTab === "Open" && conversation.status === "open") ||
      (activeTab === "Waiting" && conversation.status === "waiting") ||
      (activeTab === "Resolved" && conversation.status === "resolved") ||
      (activeTab === "Mine" && conversation.agentId === currentUserId);
    const matchSearch =
      !search ||
      conversation.name.toLowerCase().includes(search.toLowerCase()) ||
      conversation.phone.includes(search);
    return matchTab && matchSearch;
  });

  async function handleSendMessage() {
    const content = inputText.trim();
    if (!content || !selected) return;

    const optimisticMessage: Message = {
      id: `local_${Date.now()}`,
      content,
      from: "agent",
      time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      status: "sent",
    };

    setInputText("");
    setSendError("");
    setConversations((items) =>
      items.map((conversation) =>
        conversation.id === selected.id
          ? { ...conversation, preview: content, unread: 0, messages: [...conversation.messages, optimisticMessage] }
          : conversation
      )
    );

    try {
      await sendConversationMessage(selected.id, content);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Message could not be sent.");
      setConversations((items) =>
        items.map((conversation) =>
          conversation.id === selected.id
            ? {
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === optimisticMessage.id ? { ...message, status: "failed" } : message
                ),
              }
            : conversation
        )
      );
    }
  }
  async function handleAssign(userId: string) {
    if (!selected) return;
    setAssigning(true);
    try {
      const response = await assignConversation<{ data: Conversation }>(selected.id, userId);
      setConversations((items) => mergeConversation(items, response.data));
      setSelectedId(response.data.id);
    } finally {
      setAssigning(false);
    }
  }

  async function handleAddToCrm() {
    if (!selected) return;

    setCrmSaving(true);
    setCrmNotice("");
    try {
      const response = await addConversationToCrm<{ data: Conversation }>(selected.id);
      setConversations((items) => mergeConversation(items, response.data));
      setSelectedId(response.data.id);
      setCrmNotice("Lead saved to CRM");
    } catch (error) {
      setCrmNotice(error instanceof Error ? error.message : "Lead could not be saved to CRM.");
    } finally {
      setCrmSaving(false);
    }
  }

  if (!selected) {
    return <div className="flex-1 p-6 text-sm text-muted-foreground">No conversations available.</div>;
  }

  const selectedIsInCrm = Boolean(selected.crmAddedAt || selected.tags.includes("Lead"));
  const selectedCrmStage = selected.crmStage?.replace(/_/g, " ") || "new lead";

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-72 xl:w-80 flex flex-col border-r border-border shrink-0">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Inbox</h2>
            <div className="flex items-center gap-1">
              <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <Filter size={13} />
              </button>
              <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <Plus size={13} />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="pl-8 h-7 text-xs bg-secondary border-transparent focus:border-border"
            />
          </div>
          <div className="flex gap-0.5">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 text-xs py-1 rounded transition-colors ${
                  activeTab === tab
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => setSelectedId(conversation.id)}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 border-b border-border hover:bg-secondary/50 transition-colors text-left ${
                selected.id === conversation.id ? "bg-primary/10 border-l-2 border-l-primary" : ""
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-medium text-foreground">
                  {conversation.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-medium text-foreground truncate">{conversation.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{conversation.time}</span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{conversation.preview}</p>
                <div className="flex items-center gap-1 mt-1">
                  <Badge variant="outline" className={`text-[10px] px-1 py-0 h-4 ${statusColor[conversation.status]}`}>
                    {conversation.status}
                  </Badge>
                  {conversation.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0 h-4 border-border text-muted-foreground">
                      {tag}
                    </Badge>
                  ))}
                  {conversation.unread > 0 && (
                    <span className="ml-auto w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                      {conversation.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-12 px-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
              <span className="text-xs font-medium text-foreground">
                {selected.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
              </span>
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">{selected.name}</div>
              <div className="text-[11px] text-muted-foreground">{selected.phone}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={selected.agentId || ""}
              onChange={(event) => handleAssign(event.target.value)}
              disabled={assigning}
              className="h-7 max-w-40 rounded-md border border-border bg-secondary px-2 text-xs text-foreground outline-none"
              title="Assign conversation"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>{member.name}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant={selectedIsInCrm ? "outline" : "default"}
              className={`h-7 text-xs px-2 ${selectedIsInCrm ? "border-primary/30 text-primary hover:text-primary" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
              onClick={handleAddToCrm}
              disabled={crmSaving || selectedIsInCrm}
            >
              {selectedIsInCrm ? <CheckCircle2 size={13} className="mr-1.5" /> : <UserPlus size={13} className="mr-1.5" />}
              {crmSaving ? "Saving" : selectedIsInCrm ? "In CRM" : "Add to CRM"}
            </Button>
            {[Phone, User, Tag, RefreshCw, MoreVertical].map((Icon) => (
              <button key={Icon.displayName || Icon.name} className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <Icon size={13} />
              </button>
            ))}
            {selected.status !== "resolved" && (
              <Button size="sm" className="h-6 text-xs px-2 ml-1 bg-primary text-primary-foreground hover:bg-primary/90">
                Resolve
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-background">
          <div className="text-center mb-4">
            <span className="text-[11px] text-muted-foreground bg-secondary px-3 py-1 rounded-full">
              Today - {selected.messages[0]?.time}
            </span>
          </div>

          {selected.messages.map((message) => (
            <div key={message.id} className={`flex ${message.from === "agent" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-xs xl:max-w-md rounded-lg px-3 py-2 ${
                  message.from === "agent"
                    ? "bg-primary/20 text-foreground rounded-br-sm"
                    : "bg-card text-foreground border border-border rounded-bl-sm"
                }`}
              >
                <p className="text-sm leading-relaxed">{message.content}</p>
                <div className={`flex items-center gap-1 mt-1 ${message.from === "agent" ? "justify-end" : "justify-start"}`}>
                  <span className="text-[10px] text-muted-foreground">{message.time}</span>
                  {message.from === "agent" && message.status && (
                    message.status === "failed" ? (
                      <span className="text-[10px] text-destructive">failed</span>
                    ) : (
                      <CheckCheck size={11} className={message.status === "read" ? "text-primary" : "text-muted-foreground"} />
                    )
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border p-3 space-y-2">
          {sendError && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
              {sendError}
            </div>
          )}
          {crmNotice && (
            <div className={`text-xs rounded px-3 py-2 border ${crmNotice.includes("saved") ? "text-primary bg-primary/10 border-primary/20" : "text-destructive bg-destructive/10 border-destructive/20"}`}>
              {crmNotice}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button className="text-[11px] text-muted-foreground bg-secondary hover:bg-secondary/80 px-2 py-1 rounded">
              Reply
            </button>
            <button className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded">
              Note
            </button>
            <button className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded flex items-center gap-1">
              Template <ChevronDown size={10} />
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 bg-secondary rounded-lg px-3 py-2">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type a message..."
                rows={2}
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none"
              />
              <div className="flex items-center gap-1 pt-1.5">
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Paperclip size={14} />
                </button>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Smile size={14} />
                </button>
              </div>
            </div>
            <Button
              size="icon"
              className="h-9 w-9 bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
              disabled={!inputText.trim()}
              onClick={handleSendMessage}
            >
              <Send size={14} />
            </Button>
          </div>
        </div>
      </div>

      <div className="w-60 border-l border-border flex-col shrink-0 overflow-y-auto hidden xl:flex">
        <div className="p-4 border-b border-border">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
              <span className="text-sm font-medium text-foreground">
                {selected.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
              </span>
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">{selected.name}</div>
              <div className="text-xs text-muted-foreground">{selected.phone}</div>
            </div>
            <Badge variant="outline" className={`text-xs ${statusColor[selected.status]}`}>
              {selected.status}
            </Badge>
          </div>
        </div>

        <div className="p-3 space-y-4 flex-1">
          <section>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Details</h4>
            <div className="space-y-2">
              {[
                { label: "Assigned to", value: selected.agent || "Unassigned" },
                { label: "Status", value: selected.status },
                { label: "Channel", value: "WhatsApp" },
                { label: "Started", value: "Today, 10:32 AM" },
              ].map((detail) => (
                <div key={detail.label} className="flex justify-between items-start">
                  <span className="text-[11px] text-muted-foreground">{detail.label}</span>
                  <span className="text-[11px] text-foreground text-right max-w-[100px] capitalize">{detail.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">CRM</h4>
            <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-2.5">
              <div className="flex justify-between gap-3">
                <span className="text-[11px] text-muted-foreground">Stage</span>
                <span className="text-[11px] text-foreground capitalize">{selectedCrmStage}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[11px] text-muted-foreground">Source</span>
                <span className="text-[11px] text-foreground">{selected.source || "WhatsApp"}</span>
              </div>
              <Button
                size="sm"
                variant={selectedIsInCrm ? "outline" : "default"}
                className="h-7 w-full text-xs"
                onClick={handleAddToCrm}
                disabled={crmSaving || selectedIsInCrm}
              >
                {selectedIsInCrm ? "Saved in CRM" : crmSaving ? "Saving..." : "Add to CRM"}
              </Button>
            </div>
          </section>
          <section>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tags</h4>
            <div className="flex flex-wrap gap-1">
              {selected.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[11px] border-border text-muted-foreground">
                  {tag}
                </Badge>
              ))}
              <button className="text-[11px] text-primary hover:underline">+ Add</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

