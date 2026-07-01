import { useEffect, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  Archive,
  ArrowLeft,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  File,
  FileAudio,
  FileText,
  Forward,
  Image,
  Info,
  Link,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Share2,
  Smile,
  Star,
  Tag,
  Trash2,
  User,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import {
  addConversationToCrm,
  assignConversation,
  deleteConversationMessage,
  getMessageInfo,
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
  uploadMedia,
  updateMessageActions,
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
  attachments?: Attachment[];
  replyToMessageId?: string;
  internal?: boolean;
  pinned?: boolean;
  starred?: boolean;
  providerMessageId?: string;
  sentAt?: string;
  receivedAt?: string;
  createdAt?: string;
  updatedAt?: string;
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

interface Attachment {
  name: string;
  url: string;
  type?: string;
  mimeType?: string;
  size?: number;
}

interface PendingMedia {
  file: File;
  previewUrl: string;
  kind: "image" | "video" | "audio" | "document";
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
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showAttachmentInput, setShowAttachmentInput] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const [sendError, setSendError] = useState("");
  const [crmSaving, setCrmSaving] = useState(false);
  const [crmNotice, setCrmNotice] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateParameters, setTemplateParameters] = useState("");
  const [templateSending, setTemplateSending] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [actionMenuMessageId, setActionMenuMessageId] = useState("");
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [messageInfo, setMessageInfo] = useState<Message | null>(null);
  const [messageActionNotice, setMessageActionNotice] = useState("");

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
        setMobileChatOpen(true);
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
  const pinnedMessages = visibleMessages.filter((message) => message.pinned);

  function mediaKind(file: File): PendingMedia["kind"] {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return "document";
  }

  function addMediaFiles(files: File[]) {
    if (!files.length) return;
    const nextItems = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      kind: mediaKind(file),
    }));
    setPendingMedia((current) => {
      const combined = [...current, ...nextItems].slice(0, 5);
      nextItems.forEach((item) => {
        if (!combined.includes(item)) URL.revokeObjectURL(item.previewUrl);
      });
      return combined;
    });
    setSelectedMediaIndex((current) => Math.min(current, Math.max(0, pendingMedia.length + nextItems.length - 1)));
    setShowAttachmentInput(false);
  }

  function removePendingMedia(index: number) {
    setPendingMedia((current) => {
      const item = current[index];
      if (item) URL.revokeObjectURL(item.previewUrl);
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      setSelectedMediaIndex((selectedIndex) => Math.min(selectedIndex, Math.max(0, next.length - 1)));
      return next;
    });
  }

  function clearPendingMedia() {
    pendingMedia.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setPendingMedia([]);
    setSelectedMediaIndex(0);
  }

  function formatBytes(size = 0) {
    if (!size) return "";
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  function attachmentDisplayUrl(url = "") {
    if (!url) return "";
    return url.replace(`${window.location.origin}/uploads/`, `${window.location.origin}/api/uploads/`);
  }

  function messageText(message: Message) {
    const attachmentLinks = (message.attachments || []).map((attachment) => attachmentDisplayUrl(attachment.url)).filter(Boolean);
    return [message.content, ...attachmentLinks].filter(Boolean).join("\n");
  }

  function primaryAttachment(message: Message) {
    return message.attachments?.find((attachment) => attachment.url);
  }

  function updateSelectedMessage(messageId: string, patch: Partial<Message>) {
    if (!selected) return;
    setConversations((items) =>
      items.map((conversation) =>
        conversation.id === selected.id
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId ? { ...message, ...patch } : message
              ),
            }
          : conversation
      )
    );
  }

  async function persistSelectedMessage(message: Message, patch: Partial<Message>) {
    updateSelectedMessage(message.id, patch);
    if (!selected || message.id.startsWith("local_")) return;

    try {
      const response = await updateMessageActions<{ data: Message }>(selected.id, message.id, {
        pinned: patch.pinned,
        starred: patch.starred,
      });
      updateSelectedMessage(message.id, response.data);
    } catch (error) {
      updateSelectedMessage(message.id, { pinned: message.pinned, starred: message.starred });
      setMessageActionNotice(error instanceof Error ? error.message : "Message action could not be saved");
    }
  }

  function toggleMessageSelection(messageId: string) {
    setSelectedMessageIds((items) =>
      items.includes(messageId) ? items.filter((id) => id !== messageId) : [...items, messageId]
    );
  }

  async function deleteMessages(messageIds: string[]) {
    if (!selected || messageIds.length === 0) return;
    const previous = selected;
    setConversations((items) =>
      items.map((conversation) => {
        if (conversation.id !== selected.id) return conversation;
        const messages = conversation.messages.filter((message) => !messageIds.includes(message.id));
        return {
          ...conversation,
          messages,
          preview: messages[messages.length - 1]?.content || "No messages yet",
        };
      })
    );
    setSelectedMessageIds((items) => items.filter((id) => !messageIds.includes(id)));
    setActionMenuMessageId("");

    const persistedIds = messageIds.filter((id) => !id.startsWith("local_"));
    if (!persistedIds.length) return;

    try {
      await Promise.all(persistedIds.map((id) => deleteConversationMessage(selected.id, id)));
    } catch (error) {
      setConversations((items) => items.map((conversation) => (conversation.id === previous.id ? previous : conversation)));
      setMessageActionNotice(error instanceof Error ? error.message : "Message could not be deleted");
    }
  }

  async function copyMessage(message: Message) {
    await navigator.clipboard?.writeText(messageText(message));
    setMessageActionNotice("Message copied");
  }

  function saveMessageAs(message: Message) {
    const attachment = primaryAttachment(message);
    if (attachment) {
      const link = document.createElement("a");
      link.href = attachmentDisplayUrl(attachment.url);
      link.download = attachment.name || "attachment";
      link.target = "_blank";
      link.rel = "noreferrer";
      link.click();
      return;
    }

    const blob = new Blob([messageText(message)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `message-${message.id}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function shareMessage(message: Message) {
    const text = messageText(message);
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard?.writeText(text);
    setMessageActionNotice("Share text copied");
  }

  function openMessage(message: Message) {
    const attachment = primaryAttachment(message);
    const target = attachment ? attachmentDisplayUrl(attachment.url) : `data:text/plain;charset=utf-8,${encodeURIComponent(messageText(message))}`;
    window.open(target, "_blank", "noopener,noreferrer");
  }

  async function handleMessageAction(action: string, message: Message) {
    setActionMenuMessageId("");
    setMessageActionNotice("");

    try {
      if (action === "info") {
        setMessageInfo(message);
        if (selected && !message.id.startsWith("local_")) {
          getMessageInfo<{ data: Message }>(selected.id, message.id)
            .then((response) => setMessageInfo(response.data))
            .catch(() => undefined);
        }
      }
      if (action === "reply") setReplyTo(message);
      if (action === "copy") await copyMessage(message);
      if (action === "forward") {
        setComposerMode("reply");
        setInputText(`Forwarded:\n${messageText(message)}`);
        setMessageActionNotice("Forward draft ready");
      }
      if (action === "pin") await persistSelectedMessage(message, { pinned: !message.pinned });
      if (action === "star") await persistSelectedMessage(message, { starred: !message.starred });
      if (action === "select") toggleMessageSelection(message.id);
      if (action === "save") saveMessageAs(message);
      if (action === "share") await shareMessage(message);
      if (action === "open") openMessage(message);
      if (action === "delete") await deleteMessages([message.id]);
    } catch (error) {
      setMessageActionNotice(error instanceof Error ? error.message : "Action failed");
    }
  }

  async function buildAttachments() {
    const uploaded: Attachment[] = [];
    for (const item of pendingMedia) {
      const response = await uploadMedia<{ data: Attachment }>(item.file);
      uploaded.push(response.data);
    }

    const cleanAttachmentUrl = attachmentUrl.trim();
    if (cleanAttachmentUrl) {
      uploaded.push({
        name: cleanAttachmentUrl.split("/").filter(Boolean).pop() || "Attachment",
        url: cleanAttachmentUrl,
        type: "link",
      });
    }
    return uploaded;
  }

  async function handleSendMessage() {
    const content = inputText.trim();
    if ((!content && pendingMedia.length === 0 && !attachmentUrl.trim()) || !selected || uploadingMedia) return;

    let attachments: Attachment[] = [];
    try {
      setUploadingMedia(true);
      attachments = await buildAttachments();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Media could not be uploaded.");
      setUploadingMedia(false);
      return;
    }

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
    clearPendingMedia();
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
    } finally {
      setUploadingMedia(false);
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
    <div className="min-h-0 flex-1 flex overflow-hidden bg-[#111b21]">
      <aside className={`${mobileChatOpen ? "hidden" : "flex"} w-full flex-col border-r border-[#2a3942] bg-[#111b21] shrink-0 md:flex md:w-80 xl:w-[360px]`}>
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
          <div className="no-scrollbar flex gap-1 overflow-x-auto">
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

        <div className="no-scrollbar flex-1 overflow-y-auto">
          {filtered.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => {
                setSelectedId(conversation.id);
                setMobileChatOpen(true);
              }}
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

      <section className={`${mobileChatOpen ? "flex" : "hidden"} min-w-0 flex-1 flex-col overflow-hidden md:flex`}>
        <div className="min-h-14 px-2.5 md:px-4 border-b border-[#2a3942] bg-[#202c33] flex items-center justify-between gap-2 shrink-0">
          <div className="flex min-w-0 items-center gap-2 md:gap-2.5">
            <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#aebac1] hover:bg-[#2a3942] md:hidden" onClick={() => setMobileChatOpen(false)}>
              <ArrowLeft size={18} />
            </button>
            <div className="w-10 h-10 rounded-full bg-[#2a3942] flex items-center justify-center">
              <span className="text-sm font-medium text-[#e9edef]">{initials(selected.name)}</span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[#e9edef]">{selected.name}</div>
              <div className="truncate text-[11px] text-[#8696a0]">{selected.phone} - {selected.agent || "Unassigned"}</div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
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
              className="hidden h-7 max-w-40 rounded-md border border-[#2a3942] bg-[#111b21] px-2 text-xs text-[#e9edef] outline-none sm:block"
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
              className={`hidden h-7 text-xs px-2 sm:inline-flex ${selectedIsInCrm ? "border-[#00a884]/30 text-[#00a884] hover:text-[#00a884]" : "bg-[#00a884] text-black hover:bg-[#06cf9c]"}`}
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
              <Button size="sm" className="hidden h-7 text-xs px-2 ml-1 bg-[#00a884] text-black hover:bg-[#06cf9c] sm:inline-flex" onClick={() => handleStatusChange("resolved")}>
                Resolve
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="hidden h-7 text-xs px-2 ml-1 border-[#2a3942] text-[#e9edef] sm:inline-flex" onClick={() => handleStatusChange("open")}>
                Reopen
              </Button>
            )}
          </div>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto p-2.5 md:p-4 space-y-2 bg-[#0b141a] bg-[radial-gradient(circle_at_top_left,rgba(0,168,132,0.08),transparent_32%),linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px)] [background-size:auto,28px_28px]">
          <div className="text-center mb-4">
            <span className="text-[11px] text-[#8696a0] bg-[#182229] px-3 py-1 rounded-full">
              Today - {selected.messages[0]?.time}
            </span>
          </div>

          {messageActionNotice && (
            <div className="mx-auto w-fit rounded-full bg-[#182229] px-3 py-1 text-[11px] text-[#aebac1]">
              {messageActionNotice}
            </div>
          )}

          {selectedMessageIds.length > 0 && (
            <div className="sticky top-0 z-20 mx-auto flex w-fit items-center gap-2 rounded-full border border-[#2a3942] bg-[#111b21]/95 px-3 py-1.5 text-xs text-[#e9edef] shadow-xl">
              <span>{selectedMessageIds.length} selected</span>
              <button className="text-[#00a884] hover:underline" onClick={() => setSelectedMessageIds([])}>Clear</button>
              <button className="text-red-300 hover:underline" onClick={() => deleteMessages(selectedMessageIds)}>Delete</button>
            </div>
          )}

          {pinnedMessages.length > 0 && (
            <div className="sticky top-9 z-10 rounded-md border border-[#2a3942] bg-[#111b21]/95 px-3 py-2 text-xs text-[#e9edef] shadow-xl">
              <div className="mb-1 flex items-center gap-1.5 text-[#00a884]">
                <Pin size={12} />
                <span>Pinned</span>
              </div>
              <div className="truncate text-[#aebac1]">{pinnedMessages[0].content || pinnedMessages[0].attachments?.[0]?.name || "Attachment"}</div>
            </div>
          )}

          {visibleMessages.map((message) => (
            <div key={message.id} className={`flex ${message.from === "agent" ? "justify-end" : "justify-start"}`}>
              <div
                className={`group relative max-w-[86vw] sm:max-w-xs xl:max-w-md rounded-lg px-3 py-2 shadow-sm ${
                  selectedMessageIds.includes(message.id) ? "ring-2 ring-[#00a884]/70" : ""
                } ${
                  message.internal
                    ? "bg-yellow-500/10 text-yellow-100 border border-yellow-500/20"
                    : message.from === "agent"
                      ? "bg-[#005c4b] text-[#e9edef] rounded-br-sm"
                      : "bg-[#202c33] text-[#e9edef] rounded-bl-sm"
                }`}
              >
                <div className={`absolute top-1 ${message.from === "agent" ? "left-1" : "right-1"} flex items-center gap-1`}>
                  {message.starred && <Star size={11} className="fill-yellow-300 text-yellow-300" />}
                  {message.pinned && <Pin size={11} className="text-[#00a884]" />}
                  {selectedMessageIds.includes(message.id) && <CheckSquare size={12} className="text-[#00a884]" />}
                </div>
                <button
                  className={`absolute top-1 ${message.from === "agent" ? "right-1" : "left-1"} flex h-6 w-6 items-center justify-center rounded-full bg-black/15 text-[#d1d7db] hover:bg-black/30 sm:hidden sm:group-hover:flex`}
                  onClick={() => setActionMenuMessageId((current) => current === message.id ? "" : message.id)}
                  title="Message actions"
                >
                  <ChevronDown size={14} />
                </button>
                {actionMenuMessageId === message.id && (
                  <div className={`absolute top-8 z-30 w-44 rounded-lg bg-[#1f1f1f] py-1.5 text-sm text-[#f1f1f1] shadow-2xl ${message.from === "agent" ? "right-0" : "left-0"}`}>
                    {[
                      { id: "info", label: "Message info", icon: <Info size={15} /> },
                      { id: "reply", label: "Reply", icon: <Reply size={15} /> },
                      { id: "copy", label: "Copy", icon: <Copy size={15} /> },
                      { id: "forward", label: "Forward", icon: <Forward size={15} /> },
                      { id: "pin", label: message.pinned ? "Unpin" : "Pin", icon: <Pin size={15} /> },
                      { id: "star", label: message.starred ? "Unstar" : "Star", icon: <Star size={15} /> },
                      { id: "select", label: "Select", icon: <CheckSquare size={15} /> },
                      { id: "save", label: "Save as", icon: <Download size={15} /> },
                      { id: "share", label: "Share", icon: <Share2 size={15} /> },
                      { id: "open", label: "Open with", icon: <ExternalLink size={15} /> },
                      { id: "delete", label: "Delete", icon: <Trash2 size={15} /> },
                    ].map((item, index) => (
                      <button
                        key={item.id}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/10 ${[6, 10].includes(index) ? "border-t border-white/10" : ""}`}
                        onClick={() => handleMessageAction(item.id, message)}
                      >
                        <span className="w-4 text-[#f1f1f1]">{item.icon}</span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
                {message.replyToMessageId && (
                  <div className="mb-1 rounded border-l-2 border-[#00a884] bg-black/15 px-2 py-1 text-[11px] text-[#aebac1]">
                    Replying to message
                  </div>
                )}
                {message.internal && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-yellow-300">Internal note</div>}
                <p className="pr-4 text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                {message.attachments && message.attachments.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {message.attachments.map((attachment) => (
                      <div key={attachment.url} className="overflow-hidden rounded bg-black/15">
                        {attachment.type === "image" && (
                          <a href={attachmentDisplayUrl(attachment.url)} target="_blank" rel="noreferrer">
                            <img src={attachmentDisplayUrl(attachment.url)} alt={attachment.name} className="max-h-64 w-full object-cover" />
                          </a>
                        )}
                        {attachment.type === "video" && (
                          <video src={attachmentDisplayUrl(attachment.url)} controls className="max-h-64 w-full bg-black" />
                        )}
                        {attachment.type === "audio" && (
                          <div className="p-2">
                            <audio src={attachmentDisplayUrl(attachment.url)} controls className="w-full" />
                          </div>
                        )}
                        {!["image", "video", "audio"].includes(attachment.type || "") && (
                          <a href={attachmentDisplayUrl(attachment.url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-2 py-2 text-xs text-[#9fead8] hover:underline">
                            <FileText size={14} />
                            <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                            {attachment.size ? <span className="text-[#aebac1]">{formatBytes(attachment.size)}</span> : null}
                          </a>
                        )}
                      </div>
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

        <div className="border-t border-[#2a3942] bg-[#202c33] p-2.5 md:p-3 space-y-2">
          {sendError && <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{sendError}</div>}
          {crmNotice && <div className="text-xs text-[#00a884] bg-[#00a884]/10 border border-[#00a884]/20 rounded px-3 py-2">{crmNotice}</div>}

          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
            <button className={`text-[11px] px-2 py-1 rounded ${composerMode === "reply" ? "text-[#00a884] bg-[#00a884]/10" : "text-[#aebac1] hover:text-[#e9edef]"}`} onClick={() => setComposerMode("reply")}>Reply</button>
            <button className={`text-[11px] px-2 py-1 rounded ${composerMode === "note" ? "text-yellow-300 bg-yellow-500/10" : "text-[#aebac1] hover:text-[#e9edef]"}`} onClick={() => setComposerMode("note")}>Note</button>
            {quickReplies.map((reply) => (
              <button key={reply} className="hidden 2xl:inline text-[11px] text-[#aebac1] hover:text-[#e9edef] px-2 py-1 rounded" onClick={() => setInputText(reply)}>
                {reply.slice(0, 22)}
              </button>
            ))}
            <div className="flex min-w-[420px] flex-1 items-center gap-2 sm:min-w-0">
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
            <div className="rounded-lg border border-[#2a3942] bg-[#111b21] p-3 shadow-xl">
              <input
                ref={photoInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={(event) => {
                  addMediaFiles(Array.from(event.target.files || []));
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={documentInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => {
                  addMediaFiles(Array.from(event.target.files || []));
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={audioInputRef}
                type="file"
                multiple
                accept="audio/*"
                className="hidden"
                onChange={(event) => {
                  addMediaFiles(Array.from(event.target.files || []));
                  event.currentTarget.value = "";
                }}
              />

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Photos & videos", icon: <Image size={17} />, tone: "bg-[#8b5cf6]/15 text-[#c4b5fd]", action: () => photoInputRef.current?.click() },
                  { label: "Camera", icon: <Video size={17} />, tone: "bg-[#ef4444]/15 text-[#fca5a5]", action: () => photoInputRef.current?.click() },
                  { label: "Document", icon: <File size={17} />, tone: "bg-[#3b82f6]/15 text-[#93c5fd]", action: () => documentInputRef.current?.click() },
                  { label: "Audio", icon: <FileAudio size={17} />, tone: "bg-[#f59e0b]/15 text-[#fcd34d]", action: () => audioInputRef.current?.click() },
                ].map((item) => (
                  <button key={item.label} className="flex items-center gap-2 rounded-md bg-[#202c33] px-3 py-2 text-left text-xs text-[#e9edef] hover:bg-[#2a3942]" onClick={item.action}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.tone}`}>{item.icon}</span>
                    <span className="min-w-0 truncate">{item.label}</span>
                  </button>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <Input
                  value={attachmentDraft}
                  onChange={(event) => setAttachmentDraft(event.target.value)}
                  placeholder="Paste media/document URL"
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
                    clearPendingMedia();
                    setShowAttachmentInput(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {pendingMedia.length > 0 && (
            <div className="rounded-lg border border-[#2a3942] bg-[#111b21] p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-medium text-[#e9edef]">{pendingMedia.length} selected</div>
                <button className="rounded-full p-1 text-[#aebac1] hover:bg-[#2a3942] hover:text-[#e9edef]" onClick={clearPendingMedia}>
                  <X size={14} />
                </button>
              </div>
              {pendingMedia[selectedMediaIndex] && (
                <div className="mb-3 overflow-hidden rounded-md bg-[#0b141a]">
                  {pendingMedia[selectedMediaIndex].kind === "image" && (
                    <img src={pendingMedia[selectedMediaIndex].previewUrl} alt={pendingMedia[selectedMediaIndex].file.name} className="max-h-72 w-full object-contain" />
                  )}
                  {pendingMedia[selectedMediaIndex].kind === "video" && (
                    <video src={pendingMedia[selectedMediaIndex].previewUrl} controls className="max-h-72 w-full bg-black" />
                  )}
                  {pendingMedia[selectedMediaIndex].kind === "audio" && (
                    <div className="flex min-h-28 items-center justify-center p-4">
                      <audio src={pendingMedia[selectedMediaIndex].previewUrl} controls className="w-full" />
                    </div>
                  )}
                  {pendingMedia[selectedMediaIndex].kind === "document" && (
                    <div className="flex min-h-28 items-center justify-center gap-3 p-4 text-[#e9edef]">
                      <FileText size={24} className="text-[#00a884]" />
                      <div className="min-w-0">
                        <div className="truncate text-sm">{pendingMedia[selectedMediaIndex].file.name}</div>
                        <div className="text-xs text-[#8696a0]">{formatBytes(pendingMedia[selectedMediaIndex].file.size)}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                {pendingMedia.map((item, index) => (
                  <button
                    key={`${item.file.name}_${item.previewUrl}`}
                    className={`group relative h-14 w-14 shrink-0 overflow-hidden rounded-md border ${selectedMediaIndex === index ? "border-[#00a884]" : "border-[#2a3942]"}`}
                    onClick={() => setSelectedMediaIndex(index)}
                  >
                    {item.kind === "image" && <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />}
                    {item.kind === "video" && <video src={item.previewUrl} className="h-full w-full object-cover" />}
                    {item.kind === "audio" && <div className="flex h-full w-full items-center justify-center bg-[#202c33] text-[#fcd34d]"><FileAudio size={18} /></div>}
                    {item.kind === "document" && <div className="flex h-full w-full items-center justify-center bg-[#202c33] text-[#93c5fd]"><FileText size={18} /></div>}
                    <span
                      className="absolute right-0.5 top-0.5 hidden rounded-full bg-black/70 p-0.5 text-white group-hover:block"
                      onClick={(event) => {
                        event.stopPropagation();
                        removePendingMedia(index);
                      }}
                    >
                      <X size={11} />
                    </span>
                  </button>
                ))}
                <button className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-[#3b4a54] text-[#aebac1] hover:border-[#00a884] hover:text-[#00a884]" onClick={() => photoInputRef.current?.click()}>
                  <Plus size={18} />
                </button>
              </div>
            </div>
          )}

          {(replyTo || attachmentUrl || pendingMedia.length > 0) && (
            <div className="flex items-center justify-between gap-2 rounded border border-[#2a3942] bg-[#111b21] px-3 py-2 text-xs text-[#aebac1]">
              <span className="flex min-w-0 items-center gap-2 truncate">
                {(attachmentUrl || pendingMedia.length > 0) ? <FileText size={13} className="shrink-0 text-[#00a884]" /> : null}
                <span className="truncate">
                  {replyTo ? `Replying to: ${replyTo.content}` : pendingMedia.length > 0 ? `${pendingMedia.length} media file${pendingMedia.length > 1 ? "s" : ""} selected` : `Attachment: ${attachmentUrl}`}
                </span>
              </span>
              <button className="shrink-0 text-[#e9edef]" onClick={() => { setReplyTo(null); setAttachmentUrl(""); setAttachmentDraft(""); clearPendingMedia(); }}>
                Clear
              </button>
            </div>
          )}
          <div className="flex items-end gap-1.5 md:gap-2">
            <button className="h-9 w-9 rounded-full text-[#aebac1] hover:bg-[#2a3942] flex items-center justify-center">
              <Smile size={18} />
            </button>
            <button
              className="h-9 w-9 rounded-full text-[#aebac1] hover:bg-[#2a3942] flex items-center justify-center"
              onClick={() => {
                setAttachmentDraft(attachmentUrl);
                setShowAttachmentInput((value) => !value);
              }}
              title="Attach media"
            >
              <Paperclip size={18} />
            </button>
            <div className="min-w-0 flex-1 bg-[#2a3942] rounded-lg px-3 py-2">
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
            <Button size="icon" className="h-9 w-9 bg-[#00a884] text-black hover:bg-[#06cf9c] shrink-0" onClick={inputText.trim() || attachmentUrl.trim() || pendingMedia.length > 0 ? handleSendMessage : undefined} disabled={uploadingMedia}>
              {uploadingMedia ? <span className="text-[10px] font-semibold">...</span> : inputText.trim() || attachmentUrl.trim() || pendingMedia.length > 0 ? <Send size={14} /> : <Mic size={15} />}
            </Button>
          </div>
        </div>
      </section>

      {messageInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onClick={() => setMessageInfo(null)}>
          <div className="w-full max-w-sm rounded-lg border border-[#2a3942] bg-[#111b21] text-[#e9edef] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#2a3942] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Info size={16} className="text-[#00a884]" />
                Message info
              </div>
              <button className="rounded-full p-1 text-[#aebac1] hover:bg-[#2a3942] hover:text-[#e9edef]" onClick={() => setMessageInfo(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="space-y-3 p-4 text-xs">
              <div className="rounded-md bg-[#202c33] px-3 py-2 text-sm leading-relaxed">
                {messageInfo.content || messageInfo.attachments?.[0]?.name || "Attachment"}
              </div>
              {[
                ["Direction", messageInfo.from === "agent" ? "Sent by agent" : "Received from contact"],
                ["Type", messageInfo.type || "text"],
                ["Time", messageInfo.time],
                ["Status", messageInfo.status || "received"],
                ["Provider ID", messageInfo.providerMessageId || "-"],
                ["Sent at", messageInfo.sentAt ? new Date(messageInfo.sentAt).toLocaleString() : "-"],
                ["Received at", messageInfo.receivedAt ? new Date(messageInfo.receivedAt).toLocaleString() : "-"],
                ["Attachments", String(messageInfo.attachments?.length || 0)],
                ["Pinned", messageInfo.pinned ? "Yes" : "No"],
                ["Starred", messageInfo.starred ? "Yes" : "No"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <span className="text-[#8696a0]">{label}</span>
                  <span className="text-right capitalize text-[#e9edef]">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <aside className="no-scrollbar w-64 border-l border-[#2a3942] bg-[#111b21] flex-col shrink-0 overflow-y-auto hidden xl:flex">
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
