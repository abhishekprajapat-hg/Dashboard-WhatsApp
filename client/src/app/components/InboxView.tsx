import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  Archive,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  FileText,
  Link,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Plus,
  Search,
  Send,
  Smile,
  Tag,
  User,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import {
  addConversationToCrm,
  assignConversation,
  getConversationByContact,
  getConversations,
  getEventStreamUrl,
  getTeamMembers,
  getUnreadCount,
  getWhatsAppTemplates,
  markConversationRead,
  sendConversationMessage,
  sendConversationNote,
  sendConversationTemplate,
  updateConversationStatus,
} from "../lib/api";
import { demoConversations } from "../lib/demoData";

interface Message {
  id: string;
  content: string;
  from: "contact" | "agent";
  type?: "text" | "template" | "note" | "image" | "document" | "audio" | "video" | "location" | "system";
  time: string;
  status?: "sent" | "delivered" | "read" | "failed";
  attachments?: { name: string; url: string; type?: string }[];
  replyToMessageId?: string;
  internal?: boolean;
}

interface Conversation {
  id: string;
  name: string;
  phone: string;
  preview: string;
  time: string;
  unread: number;
  status: "open" | "waiting" | "resolved" | "bot" | "archived";
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

interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "approved" | "pending" | "rejected";
}

interface InboxViewProps {
  openContactId?: string | null;
  currentUserId?: string;
  onUnreadCountChange?: (count: number) => void;
}

const fallbackConversations = demoConversations as Conversation[];
const tabs = ["All", "Unread", "Open", "Waiting", "Resolved", "Mine"];
const quickReplies = [
  "Thanks for reaching out. How can I help you?",
  "Please share your requirement and preferred time.",
  "Our team will check this and get back shortly.",
];

const statusColor: Record<string, string> = {
  open: "bg-[#00a884]/15 text-[#00a884] border-[#00a884]/30",
  waiting: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  resolved: "bg-[#2a3942] text-[#aebac1] border-[#3b4a54]",
  archived: "bg-[#2a3942] text-[#aebac1] border-[#3b4a54]",
  bot: "bg-blue-500/15 text-blue-400 border-blue-500/30",
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

  return [{ ...(existing || incoming), ...incoming, messages: mergedMessages }, ...items.filter((item) => item.id !== incoming.id)];
}

function initials(name = "") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function InboxView({ openContactId, currentUserId, onUnreadCountChange }: InboxViewProps) {
  const [activeTab, setActiveTab] = useState("All");
  const [conversations, setConversations] = useState<Conversation[]>(fallbackConversations);
  const [selectedId, setSelectedId] = useState(fallbackConversations[0]?.id || "");
  const [inputText, setInputText] = useState("");
  const [search, setSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentDraft, setAttachmentDraft] = useState("");
  const [showAttachmentInput, setShowAttachmentInput] = useState(false);
  const [sendError, setSendError] = useState("");
  const [crmSaving, setCrmSaving] = useState(false);
  const [crmNotice, setCrmNotice] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateParameters, setTemplateParameters] = useState("");
  const [templateSending, setTemplateSending] = useState(false);

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

    getWhatsAppTemplates<{ data: WhatsAppTemplate[]; total: number }>()
      .then((response) => setTemplates(response.data.filter((template) => template.status === "approved")))
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
  }, [onUnreadCountChange]);

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

  const selected = conversations.find((conversation) => conversation.id === selectedId) || conversations[0];
  const filtered = conversations.filter((conversation) => {
    const matchTab =
      activeTab === "All" ||
      (activeTab === "Unread" && conversation.unread > 0) ||
      (activeTab === "Open" && conversation.status === "open") ||
      (activeTab === "Waiting" && conversation.status === "waiting") ||
      (activeTab === "Resolved" && conversation.status === "resolved") ||
      (activeTab === "Mine" && conversation.agentId === currentUserId);
    const matchSearch =
      !search ||
      conversation.name.toLowerCase().includes(search.toLowerCase()) ||
      conversation.phone.includes(search) ||
      conversation.preview.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  });
  const visibleMessages =
    selected?.messages.filter((message) =>
      messageSearch ? message.content.toLowerCase().includes(messageSearch.toLowerCase()) : true
    ) || [];

  async function handleSendMessage() {
    const content = inputText.trim();
    const cleanAttachmentUrl = attachmentUrl.trim();
    const attachments = cleanAttachmentUrl
      ? [{ name: cleanAttachmentUrl.split("/").filter(Boolean).pop() || "Attachment", url: cleanAttachmentUrl, type: "link" }]
      : [];
    if ((!content && attachments.length === 0) || !selected) return;

    const optimisticMessage: Message = {
      id: `local_${Date.now()}`,
      content: content || "Attachment",
      from: "agent",
      type: composerMode === "note" ? "note" : "text",
      time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      status: "sent",
      attachments,
      replyToMessageId: replyTo?.id,
      internal: composerMode === "note",
    };

    setInputText("");
    setAttachmentUrl("");
    setAttachmentDraft("");
    setShowAttachmentInput(false);
    setReplyTo(null);
    setSendError("");
    setConversations((items) =>
      items.map((conversation) =>
        conversation.id === selected.id
          ? { ...conversation, preview: composerMode === "note" ? conversation.preview : content || "Attachment", unread: 0, messages: [...conversation.messages, optimisticMessage] }
          : conversation
      )
    );

    try {
      if (composerMode === "note") {
        await sendConversationNote(selected.id, content);
      } else {
        await sendConversationMessage(selected.id, content, { attachments, replyToMessageId: replyTo?.id });
      }
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

  async function handleStatusChange(status: "open" | "waiting" | "resolved" | "archived") {
    if (!selected) return;
    const previous = selected;
    setSendError("");
    setConversations((items) =>
      items.map((conversation) => (conversation.id === selected.id ? { ...conversation, status } : conversation))
    );

    try {
      const response = await updateConversationStatus<{ data: Conversation }>(selected.id, status);
      setConversations((items) => mergeConversation(items, response.data));
      setSelectedId(response.data.id);
    } catch (error) {
      setConversations((items) => items.map((conversation) => (conversation.id === previous.id ? previous : conversation)));
      setSendError(error instanceof Error ? error.message : "Conversation status could not be updated.");
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

  async function handleSendTemplate() {
    if (!selected || !selectedTemplateId) return;

    const template = templates.find((item) => item.id === selectedTemplateId);
    const parameters = templateParameters
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    setTemplateSending(true);
    setSendError("");

    try {
      const response = await sendConversationTemplate<{ data: Message }>(selected.id, selectedTemplateId, parameters);
      setConversations((items) =>
        items.map((conversation) =>
          conversation.id === selected.id
            ? {
                ...conversation,
                preview: response.data.content || `Template sent: ${template?.name || "template"}`,
                messages: [...conversation.messages, response.data],
              }
            : conversation
        )
      );
      setTemplateParameters("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Template could not be sent.");
    } finally {
      setTemplateSending(false);
    }
  }

  if (!selected) {
    return <div className="flex-1 p-6 text-sm text-muted-foreground">No conversations available.</div>;
  }

  const selectedIsInCrm = Boolean(selected.crmAddedAt || selected.tags.includes("Lead"));
  const selectedCrmStage = selected.crmStage?.replace(/_/g, " ") || "new lead";

  return (
    <div className="flex-1 flex overflow-hidden bg-[#111b21]">
      <aside className="w-80 xl:w-[360px] flex flex-col border-r border-[#2a3942] bg-[#111b21] shrink-0">
        <div className="h-14 px-4 border-b border-[#2a3942] bg-[#202c33] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-[#00a884] flex items-center justify-center">
              <MessageCircle size={17} className="text-black" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#e9edef]">Chats</h2>
              <p className="text-[11px] text-[#8696a0]">{filtered.length} conversations</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button className="w-8 h-8 rounded-full flex items-center justify-center text-[#aebac1] hover:bg-[#2a3942]" title="Archive">
              <Archive size={15} />
            </button>
            <button className="w-8 h-8 rounded-full flex items-center justify-center text-[#aebac1] hover:bg-[#2a3942]" title="New chat">
              <Plus size={15} />
            </button>
          </div>
        </div>

        <div className="p-3 border-b border-[#2a3942] space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search or start new chat"
              className="pl-9 h-8 text-xs bg-[#202c33] border-transparent text-[#e9edef] placeholder:text-[#8696a0] focus:border-[#00a884]"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`shrink-0 text-xs px-2.5 py-1 rounded-full transition-colors ${
                  activeTab === tab ? "bg-[#00a884]/20 text-[#00a884]" : "text-[#8696a0] hover:text-[#e9edef] hover:bg-[#202c33]"
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
              className={`w-full flex items-start gap-3 px-3 py-3 border-b border-[#1f2c33] hover:bg-[#202c33] transition-colors text-left ${
                selected.id === conversation.id ? "bg-[#2a3942]" : ""
              }`}
            >
              <div className="w-11 h-11 rounded-full bg-[#2a3942] flex items-center justify-center shrink-0">
                <span className="text-sm font-medium text-[#e9edef]">{initials(conversation.name)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-medium text-[#e9edef] truncate">{conversation.name}</span>
                  <span className={`text-[10px] shrink-0 ${conversation.unread > 0 ? "text-[#00a884]" : "text-[#8696a0]"}`}>
                    {conversation.time}
                  </span>
                </div>
                <p className="text-xs text-[#8696a0] truncate mt-0.5">{conversation.preview}</p>
                <div className="flex items-center gap-1 mt-1">
                  <Badge variant="outline" className={`text-[10px] px-1 py-0 h-4 ${statusColor[conversation.status] || statusColor.open}`}>
                    {conversation.status}
                  </Badge>
                  {conversation.tags.slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0 h-4 border-[#3b4a54] text-[#8696a0]">
                      {tag}
                    </Badge>
                  ))}
                  {conversation.unread > 0 && (
                    <span className="ml-auto min-w-4 h-4 px-1 rounded-full bg-[#00a884] text-black text-[10px] flex items-center justify-center">
                      {conversation.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex-1 flex flex-col overflow-hidden">
        <div className="h-14 px-4 border-b border-[#2a3942] bg-[#202c33] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-[#2a3942] flex items-center justify-center">
              <span className="text-sm font-medium text-[#e9edef]">{initials(selected.name)}</span>
            </div>
            <div>
              <div className="text-sm font-medium text-[#e9edef]">{selected.name}</div>
              <div className="text-[11px] text-[#8696a0]">{selected.phone} - {selected.agent || "Unassigned"}</div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <div className="relative hidden 2xl:block">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#8696a0]" />
              <Input
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
                placeholder="Search messages"
                className="h-7 w-40 pl-7 text-[11px] bg-[#111b21] border-[#2a3942] text-[#e9edef]"
              />
              {messageSearch && (
                <button onClick={() => setMessageSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8696a0]">
                  <X size={12} />
                </button>
              )}
            </div>
            <select
              value={selected.agentId || ""}
              onChange={(event) => handleAssign(event.target.value)}
              disabled={assigning}
              className="h-7 max-w-40 rounded-md border border-[#2a3942] bg-[#111b21] px-2 text-xs text-[#e9edef] outline-none"
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
              className={`h-7 text-xs px-2 ${selectedIsInCrm ? "border-[#00a884]/30 text-[#00a884] hover:text-[#00a884]" : "bg-[#00a884] text-black hover:bg-[#06cf9c]"}`}
              onClick={handleAddToCrm}
              disabled={crmSaving || selectedIsInCrm}
            >
              {selectedIsInCrm ? <CheckCircle2 size={13} className="mr-1.5" /> : <UserPlus size={13} className="mr-1.5" />}
              {crmSaving ? "Saving" : selectedIsInCrm ? "In CRM" : "Add"}
            </Button>
            {[Phone, Video, User, Tag, MoreVertical].map((Icon) => (
              <button key={Icon.displayName || Icon.name} className="w-8 h-8 rounded-full flex items-center justify-center text-[#aebac1] hover:text-[#e9edef] hover:bg-[#2a3942]">
                <Icon size={14} />
              </button>
            ))}
            {selected.status !== "resolved" ? (
              <Button size="sm" className="h-7 text-xs px-2 ml-1 bg-[#00a884] text-black hover:bg-[#06cf9c]" onClick={() => handleStatusChange("resolved")}>
                Resolve
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2 ml-1 border-[#2a3942] text-[#e9edef]" onClick={() => handleStatusChange("open")}>
                Reopen
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#0b141a] bg-[radial-gradient(circle_at_top_left,rgba(0,168,132,0.08),transparent_32%),linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px)] [background-size:auto,28px_28px]">
          <div className="text-center mb-4">
            <span className="text-[11px] text-[#8696a0] bg-[#182229] px-3 py-1 rounded-full">
              Today - {selected.messages[0]?.time}
            </span>
          </div>

          {visibleMessages.map((message) => (
            <div key={message.id} className={`flex ${message.from === "agent" ? "justify-end" : "justify-start"}`}>
              <div
                className={`group max-w-xs xl:max-w-md rounded-lg px-3 py-2 shadow-sm ${
                  message.internal
                    ? "bg-yellow-500/10 text-yellow-100 border border-yellow-500/20"
                    : message.from === "agent"
                      ? "bg-[#005c4b] text-[#e9edef] rounded-br-sm"
                      : "bg-[#202c33] text-[#e9edef] rounded-bl-sm"
                }`}
              >
                {message.replyToMessageId && (
                  <div className="mb-1 rounded border-l-2 border-[#00a884] bg-black/15 px-2 py-1 text-[11px] text-[#aebac1]">
                    Replying to message
                  </div>
                )}
                {message.internal && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-yellow-300">Internal note</div>}
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                {message.attachments && message.attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {message.attachments.map((attachment) => (
                      <a key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer" className="block rounded bg-black/15 px-2 py-1 text-xs text-[#9fead8] hover:underline">
                        {attachment.name}
                      </a>
                    ))}
                  </div>
                )}
                <div className={`flex items-center gap-1 mt-1 ${message.from === "agent" ? "justify-end" : "justify-start"}`}>
                  {!message.internal && (
                    <button className="hidden text-[10px] text-[#aebac1] hover:text-[#e9edef] group-hover:inline" onClick={() => setReplyTo(message)}>
                      reply
                    </button>
                  )}
                  <span className="text-[10px] text-[#aebac1]">{message.time}</span>
                  {message.from === "agent" && message.status && (
                    message.status === "failed" ? (
                      <span className="text-[10px] text-red-300">failed</span>
                    ) : (
                      <CheckCheck size={11} className={message.status === "read" ? "text-sky-300" : "text-[#aebac1]"} />
                    )
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[#2a3942] bg-[#202c33] p-3 space-y-2">
          {sendError && <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{sendError}</div>}
          {crmNotice && <div className="text-xs text-[#00a884] bg-[#00a884]/10 border border-[#00a884]/20 rounded px-3 py-2">{crmNotice}</div>}

          <div className="flex items-center gap-2">
            <button className={`text-[11px] px-2 py-1 rounded ${composerMode === "reply" ? "text-[#00a884] bg-[#00a884]/10" : "text-[#aebac1] hover:text-[#e9edef]"}`} onClick={() => setComposerMode("reply")}>Reply</button>
            <button className={`text-[11px] px-2 py-1 rounded ${composerMode === "note" ? "text-yellow-300 bg-yellow-500/10" : "text-[#aebac1] hover:text-[#e9edef]"}`} onClick={() => setComposerMode("note")}>Note</button>
            {quickReplies.map((reply) => (
              <button key={reply} className="hidden 2xl:inline text-[11px] text-[#aebac1] hover:text-[#e9edef] px-2 py-1 rounded" onClick={() => setInputText(reply)}>
                {reply.slice(0, 22)}
              </button>
            ))}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative min-w-36 max-w-56 flex-1">
                <select
                  value={selectedTemplateId}
                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                  className="h-7 w-full appearance-none rounded border border-[#2a3942] bg-[#111b21] px-2 pr-6 text-[11px] text-[#e9edef] outline-none"
                >
                  <option value="">Template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.language})
                    </option>
                  ))}
                </select>
                <ChevronDown size={10} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#8696a0]" />
              </div>
              <Input
                value={templateParameters}
                onChange={(event) => setTemplateParameters(event.target.value)}
                placeholder="Variables comma-separated"
                className="h-7 max-w-56 border-[#2a3942] bg-[#111b21] text-[11px] text-[#e9edef]"
              />
              <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-[11px] border-[#2a3942]" onClick={handleSendTemplate} disabled={!selectedTemplateId || templateSending}>
                {templateSending ? "Sending" : "Send template"}
              </Button>
            </div>
          </div>

          {showAttachmentInput && (
            <div className="rounded border border-[#2a3942] bg-[#111b21] p-2">
              <div className="mb-2 flex items-center gap-2 text-xs text-[#aebac1]">
                <Link size={13} className="text-[#00a884]" />
                <span>Add an attachment URL</span>
              </div>
              <div className="flex gap-2">
                <Input
                  value={attachmentDraft}
                  onChange={(event) => setAttachmentDraft(event.target.value)}
                  placeholder="https://example.com/document.pdf"
                  className="h-8 border-[#2a3942] bg-[#202c33] text-xs text-[#e9edef] placeholder:text-[#8696a0]"
                />
                <Button
                  size="sm"
                  className="h-8 shrink-0 bg-[#00a884] px-3 text-xs text-black hover:bg-[#06cf9c]"
                  onClick={() => {
                    if (!attachmentDraft.trim()) return;
                    setAttachmentUrl(attachmentDraft.trim());
                    setShowAttachmentInput(false);
                  }}
                >
                  Attach
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 border-[#2a3942] px-3 text-xs text-[#e9edef]"
                  onClick={() => {
                    setAttachmentDraft("");
                    setShowAttachmentInput(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {(replyTo || attachmentUrl) && (
            <div className="flex items-center justify-between gap-2 rounded border border-[#2a3942] bg-[#111b21] px-3 py-2 text-xs text-[#aebac1]">
              <span className="flex min-w-0 items-center gap-2 truncate">
                {attachmentUrl ? <FileText size={13} className="shrink-0 text-[#00a884]" /> : null}
                <span className="truncate">{replyTo ? `Replying to: ${replyTo.content}` : `Attachment: ${attachmentUrl}`}</span>
              </span>
              <button className="shrink-0 text-[#e9edef]" onClick={() => { setReplyTo(null); setAttachmentUrl(""); setAttachmentDraft(""); }}>
                Clear
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <button className="h-9 w-9 rounded-full text-[#aebac1] hover:bg-[#2a3942] flex items-center justify-center">
              <Smile size={18} />
            </button>
            <button
              className="h-9 w-9 rounded-full text-[#aebac1] hover:bg-[#2a3942] flex items-center justify-center"
              onClick={() => {
                setAttachmentDraft(attachmentUrl);
                setShowAttachmentInput((value) => !value);
              }}
              title="Attach link"
            >
              <Paperclip size={18} />
            </button>
            <div className="flex-1 bg-[#2a3942] rounded-lg px-3 py-2">
              <textarea
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={composerMode === "note" ? "Write an internal note" : "Type a message"}
                rows={1}
                className="w-full bg-transparent text-sm text-[#e9edef] placeholder:text-[#8696a0] resize-none outline-none"
              />
            </div>
            <Button size="icon" className="h-9 w-9 bg-[#00a884] text-black hover:bg-[#06cf9c] shrink-0" onClick={inputText.trim() || attachmentUrl.trim() ? handleSendMessage : undefined}>
              {inputText.trim() || attachmentUrl.trim() ? <Send size={14} /> : <Mic size={15} />}
            </Button>
          </div>
        </div>
      </section>

      <aside className="w-64 border-l border-[#2a3942] bg-[#111b21] flex-col shrink-0 overflow-y-auto hidden xl:flex">
        <div className="p-4 border-b border-[#2a3942] bg-[#202c33]">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-14 h-14 rounded-full bg-[#2a3942] flex items-center justify-center">
              <span className="text-base font-medium text-[#e9edef]">{initials(selected.name)}</span>
            </div>
            <div>
              <div className="text-sm font-medium text-[#e9edef]">{selected.name}</div>
              <div className="text-xs text-[#8696a0]">{selected.phone}</div>
            </div>
            <Badge variant="outline" className={`text-xs ${statusColor[selected.status] || statusColor.open}`}>
              {selected.status}
            </Badge>
          </div>
        </div>

        <div className="p-3 space-y-4 flex-1">
          <section>
            <h4 className="text-[10px] font-semibold text-[#8696a0] uppercase tracking-wider mb-2">Details</h4>
            <div className="space-y-2">
              {[
                { label: "Assigned to", value: selected.agent || "Unassigned" },
                { label: "Status", value: selected.status },
                { label: "Channel", value: "WhatsApp" },
                { label: "Messages", value: String(selected.messages.length) },
              ].map((detail) => (
                <div key={detail.label} className="flex justify-between items-start">
                  <span className="text-[11px] text-[#8696a0]">{detail.label}</span>
                  <span className="text-[11px] text-[#e9edef] text-right max-w-[110px] capitalize">{detail.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-[10px] font-semibold text-[#8696a0] uppercase tracking-wider mb-2">Conversation</h4>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs border-[#2a3942]" onClick={() => handleStatusChange("waiting")}>Waiting</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs border-[#2a3942]" onClick={() => handleStatusChange("open")}>Open</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs border-[#2a3942]" onClick={() => handleStatusChange("resolved")}>Resolve</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs border-[#2a3942]" onClick={() => handleStatusChange("archived")}>Archive</Button>
            </div>
          </section>

          <section>
            <h4 className="text-[10px] font-semibold text-[#8696a0] uppercase tracking-wider mb-2">CRM</h4>
            <div className="space-y-2 rounded-md border border-[#2a3942] bg-[#202c33] p-2.5">
              <div className="flex justify-between gap-3">
                <span className="text-[11px] text-[#8696a0]">Stage</span>
                <span className="text-[11px] text-[#e9edef] capitalize">{selectedCrmStage}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[11px] text-[#8696a0]">Source</span>
                <span className="text-[11px] text-[#e9edef]">{selected.source || "WhatsApp"}</span>
              </div>
              <Button size="sm" variant={selectedIsInCrm ? "outline" : "default"} className="h-7 w-full text-xs" onClick={handleAddToCrm} disabled={crmSaving || selectedIsInCrm}>
                {selectedIsInCrm ? "Saved in CRM" : crmSaving ? "Saving..." : "Add to CRM"}
              </Button>
            </div>
          </section>

          <section>
            <h4 className="text-[10px] font-semibold text-[#8696a0] uppercase tracking-wider mb-2">Labels</h4>
            <div className="flex flex-wrap gap-1">
              {selected.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[11px] border-[#3b4a54] text-[#aebac1]">
                  {tag}
                </Badge>
              ))}
              <button className="text-[11px] text-[#00a884] hover:underline">+ Add</button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
