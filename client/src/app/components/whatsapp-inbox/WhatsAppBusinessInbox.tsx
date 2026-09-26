import { useEffect, useRef, useState } from "react";
import type { Conversation, InboxFilter, PendingMedia, TeamMember, UploadState, WhatsAppMessage } from "./types";
import { ChatWindow } from "./ChatWindow";
import { COMPOSER_ID } from "./Composer";
import { ConversationList } from "./ConversationList";
import { CustomerProfileSidebar } from "./CustomerProfileSidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/sheet";
import { useIsMobile } from "../ui/use-mobile";
import { conversationMeta } from "./utils";

interface WhatsAppBusinessInboxProps {
  conversations: Conversation[];
  channelCounts?: { whatsapp: number; instagram: number; facebook: number } | null;
  selectedId: string;
  filter: InboxFilter;
  search: string;
  messageSearch: string;
  currentUserId?: string;
  typingIds: string[];
  members: TeamMember[];
  inputText: string;
  composerMode: "reply" | "note";
  replyTo: WhatsAppMessage | null;
  pendingMedia: PendingMedia[];
  uploading: boolean;
  sendError?: string | null;
  uploadById: Record<string, UploadState>;
  recording: boolean;
  quickReplies?: { id: string; name: string; body: string }[];
  suggestingReply?: boolean;
  suggestReplyError?: string;
  sessionExpired?: boolean;
  crmSaving: boolean;
  assigning: boolean;
  mobileChatOpen: boolean;
  loading: boolean;
  error: string;
  hasMoreConversations?: boolean;
  loadingMoreConversations?: boolean;
  onLoadMoreConversations?: () => void;
  onFilterChange: (filter: InboxFilter) => void;
  onSearchChange: (search: string) => void;
  onMessageSearchChange: (value: string) => void;
  onSelectConversation: (id: string) => void;
  onRetryLoad: () => void;
  onBackToList: () => void;
  onInputChange: (value: string) => void;
  onComposerModeChange: (mode: "reply" | "note") => void;
  onSend: () => void;
  onPickFiles: (kind: "media" | "document" | "audio") => void;
  onPickProduct?: () => void;
  onOpenTemplatePicker?: () => void;
  onRemoveMedia: (index: number) => void;
  onClearContext: () => void;
  onToggleRecording: () => void;
  onQuickReplySelect?: (template: { id: string; name: string; body: string }, options?: { replace?: boolean }) => void;
  onSuggestReply?: () => void;
  onMessageAction: (action: "reply" | "copy" | "forward" | "star" | "delete" | "retry" | "download", message: WhatsAppMessage) => void;
  onAssign: (userId: string) => void;
  onStatusChange: (status: Conversation["status"]) => void;
  onConversationSetting: (settings: { pinned?: boolean; muted?: boolean }) => void;
  onLoadOlderMessages: () => void;
  onAddToCrm: (stage?: string) => void;
  onResetForTesting?: () => void;
}

const PROFILE_KEY = "nemnidhi_inbox_profile";

function readProfilePref() {
  try {
    return localStorage.getItem(PROFILE_KEY) !== "0";
  } catch {
    return true;
  }
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function WhatsAppBusinessInbox(props: WhatsAppBusinessInboxProps) {
  const {
    conversations,
    channelCounts,
    selectedId,
    filter,
    search,
    currentUserId,
    typingIds,
    members,
    crmSaving,
    assigning,
    mobileChatOpen,
    loading,
    error,
    hasMoreConversations,
    loadingMoreConversations,
    onLoadMoreConversations,
    onFilterChange,
    onSearchChange,
    onSelectConversation,
    onRetryLoad,
    onBackToList,
    onAssign,
    onStatusChange,
    onConversationSetting,
    onAddToCrm,
  } = props;
  const isMobile = useIsMobile();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const selected = conversations.find((conversation) => conversation.id === selectedId) || conversations[0];
  const selectedMeta = selected ? conversationMeta(selected) : { isInCrm: false };
  const [showProfile, setShowProfile] = useState(readProfilePref);
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);

  function toggleProfile() {
    if (isMobile) {
      setMobileProfileOpen((open) => !open);
      return;
    }
    setShowProfile((current) => {
      const next = !current;
      try {
        localStorage.setItem(PROFILE_KEY, next ? "1" : "0");
      } catch {
        // just won't be remembered
      }
      return next;
    });
  }

  // Keyboard triage (desktop): J/K or arrow keys move between chats in the order shown, "/" jumps
  // to the chat search, R puts the cursor in the reply box. Never while typing or in a dialog.
  const navState = useRef({ selectedId: selected?.id || "" });
  navState.current = { selectedId: selected?.id || "" };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')) return;
      const key = event.key;
      if (key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (key === "r" || key === "R") {
        const composer = document.getElementById(COMPOSER_ID);
        if (composer) {
          event.preventDefault();
          composer.focus();
        }
        return;
      }
      const down = key === "j" || key === "ArrowDown";
      const up = key === "k" || key === "ArrowUp";
      if (!down && !up) return;
      // Walk the rows as rendered, so collapsed channel sections and filters are respected.
      const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-conversation-id]"));
      if (!rows.length) return;
      event.preventDefault();
      const index = rows.findIndex((row) => row.dataset.conversationId === navState.current.selectedId);
      const next = rows[Math.max(0, Math.min(rows.length - 1, index === -1 ? 0 : index + (down ? 1 : -1)))];
      const nextId = next?.dataset.conversationId;
      if (nextId && nextId !== navState.current.selectedId) {
        onSelectConversation(nextId);
        next.scrollIntoView({ block: "nearest" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelectConversation]);

  const list = (
    <ConversationList
      ref={searchRef}
      conversations={conversations}
      channelCounts={channelCounts}
      selectedId={selected?.id || ""}
      filter={filter}
      search={search}
      currentUserId={currentUserId}
      typingIds={typingIds}
      loading={loading}
      error={error}
      hasMore={hasMoreConversations}
      loadingMore={loadingMoreConversations}
      onLoadMore={onLoadMoreConversations}
      onFilterChange={onFilterChange}
      onSearchChange={onSearchChange}
      onSelect={onSelectConversation}
      onRetry={onRetryLoad}
    />
  );

  const chat = (
    <ChatWindow
      conversation={selected}
      messages={selected?.messages || []}
      messageSearch={props.messageSearch}
      inputText={props.inputText}
      composerMode={props.composerMode}
      replyTo={props.replyTo}
      pendingMedia={props.pendingMedia}
      uploading={props.uploading}
      sendError={props.sendError}
      uploadById={props.uploadById}
      recording={props.recording}
      quickReplies={props.quickReplies}
      suggestingReply={props.suggestingReply}
      suggestReplyError={props.suggestReplyError}
      sessionExpired={props.sessionExpired}
      typing={selected ? typingIds.includes(selected.id) : false}
      crmSaving={crmSaving}
      isInCrm={Boolean(selectedMeta.isInCrm)}
      profileOpen={isMobile ? mobileProfileOpen : showProfile}
      onToggleProfile={selected ? toggleProfile : undefined}
      onBack={onBackToList}
      onMessageSearchChange={props.onMessageSearchChange}
      onInputChange={props.onInputChange}
      onComposerModeChange={props.onComposerModeChange}
      onSend={props.onSend}
      onPickFiles={props.onPickFiles}
      onPickProduct={props.onPickProduct}
      onOpenTemplatePicker={props.onOpenTemplatePicker}
      onRemoveMedia={props.onRemoveMedia}
      onClearContext={props.onClearContext}
      onToggleRecording={props.onToggleRecording}
      onQuickReplySelect={props.onQuickReplySelect}
      onSuggestReply={props.onSuggestReply}
      onMessageAction={props.onMessageAction}
      onAddToCrm={onAddToCrm}
      onResolve={() => onStatusChange("resolved")}
      onResetForTesting={props.onResetForTesting}
      onLoadOlder={props.onLoadOlderMessages}
    />
  );

  const profile = (onClose?: () => void) =>
    selected ? (
      <CustomerProfileSidebar
        conversation={selected}
        members={members}
        savingCrm={crmSaving}
        assigning={assigning}
        onAssign={onAssign}
        onStatusChange={onStatusChange}
        onConversationSetting={onConversationSetting}
        onAddToCrm={onAddToCrm}
        onClose={onClose}
      />
    ) : null;

  if (isMobile) {
    // Phone: one pane at a time, list <-> chat, with customer details in a sheet.
    return (
      <div className="flex h-full min-h-0 w-full overflow-hidden bg-card text-foreground">
        <div className="flex min-w-0 flex-1">{mobileChatOpen ? chat : list}</div>
        <Sheet open={mobileProfileOpen && Boolean(selected)} onOpenChange={setMobileProfileOpen}>
          <SheetContent side="right" className="w-[min(22rem,92vw)] gap-0 p-0 [&>button:last-child]:hidden">
            <SheetTitle className="sr-only">Customer details</SheetTitle>
            <SheetDescription className="sr-only">Owner, lead stage and conversation status</SheetDescription>
            {profile(() => setMobileProfileOpen(false))}
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  // Desktop: resizable list / chat / customer panes; the customer pane can be hidden (remembered).
  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-card text-foreground">
      <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 w-full">
        <ResizablePanel defaultSize={27} minSize={20} maxSize={40}>
          {list}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={showProfile ? 50 : 73} minSize={32}>
          <div className="flex h-full min-w-0 flex-1">{chat}</div>
        </ResizablePanel>
        {selected && showProfile ? (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize={23} minSize={17} maxSize={34}>
              {profile()}
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
    </div>
  );
}
