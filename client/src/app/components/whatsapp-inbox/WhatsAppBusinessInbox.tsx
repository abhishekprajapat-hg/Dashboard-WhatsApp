import { useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { Conversation, InboxFilter, PendingMedia, TeamMember, UploadState, WhatsAppMessage } from "./types";
import { ChatWindow } from "./ChatWindow";
import { ConversationList } from "./ConversationList";
import { CustomerProfileSidebar } from "./CustomerProfileSidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { conversationMeta } from "./utils";

interface WhatsAppBusinessInboxProps {
  conversations: Conversation[];
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
  crmSaving: boolean;
  assigning: boolean;
  mobileChatOpen: boolean;
  loading: boolean;
  error: string;
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
  onRemoveMedia: (index: number) => void;
  onClearContext: () => void;
  onToggleRecording: () => void;
  onQuickReplySelect?: (template: { id: string; name: string; body: string }) => void;
  onSuggestReply?: () => void;
  onMessageAction: (action: "reply" | "copy" | "forward" | "star" | "delete" | "retry" | "download", message: WhatsAppMessage) => void;
  onAssign: (userId: string) => void;
  onStatusChange: (status: Conversation["status"]) => void;
  onConversationSetting: (settings: { pinned?: boolean; muted?: boolean }) => void;
  onLoadOlderMessages: () => void;
  onAddToCrm: (stage?: string) => void;
  onResetForTesting?: () => void;
}

export function WhatsAppBusinessInbox({
  conversations,
  selectedId,
  filter,
  search,
  messageSearch,
  currentUserId,
  typingIds,
  members,
  inputText,
  composerMode,
  replyTo,
  pendingMedia,
  uploading,
  sendError,
  uploadById,
  recording,
  quickReplies = [],
  suggestingReply,
  suggestReplyError,
  crmSaving,
  assigning,
  mobileChatOpen,
  loading,
  error,
  onSearchChange,
  onMessageSearchChange,
  onSelectConversation,
  onRetryLoad,
  onBackToList,
  onInputChange,
  onComposerModeChange,
  onSend,
  onPickFiles,
  onPickProduct,
  onRemoveMedia,
  onClearContext,
  onToggleRecording,
  onQuickReplySelect,
  onSuggestReply,
  onMessageAction,
  onAssign,
  onStatusChange,
  onConversationSetting,
  onLoadOlderMessages,
  onAddToCrm,
  onResetForTesting,
}: WhatsAppBusinessInboxProps) {
  const selected = conversations.find((conversation) => conversation.id === selectedId) || conversations[0];
  const selectedMeta = selected ? conversationMeta(selected) : { isInCrm: false };
  const [showProfile, setShowProfile] = useState(true);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-surface text-foreground">
      {/* Mobile: single pane at a time, same swap behavior as before - untouched. */}
      <div className={mobileChatOpen ? "hidden md:hidden" : "flex min-w-0 flex-1 md:hidden"}>
        <ConversationList
          conversations={conversations}
          selectedId={selected?.id || ""}
          filter={filter}
          search={search}
          currentUserId={currentUserId}
          typingIds={typingIds}
          loading={loading}
          error={error}
          onSearchChange={onSearchChange}
          onSelect={onSelectConversation}
          onRetry={onRetryLoad}
        />
      </div>
      <div className={mobileChatOpen ? "flex min-w-0 flex-1 md:hidden" : "hidden md:hidden"}>
        <ChatWindow
          conversation={selected}
          messages={selected?.messages || []}
          messageSearch={messageSearch}
          inputText={inputText}
          composerMode={composerMode}
          replyTo={replyTo}
          pendingMedia={pendingMedia}
          uploading={uploading}
          sendError={sendError}
          uploadById={uploadById}
          recording={recording}
          quickReplies={quickReplies}
          suggestingReply={suggestingReply}
          suggestReplyError={suggestReplyError}
          typing={selected ? typingIds.includes(selected.id) : false}
          crmSaving={crmSaving}
          isInCrm={Boolean(selectedMeta.isInCrm)}
          onBack={onBackToList}
          onMessageSearchChange={onMessageSearchChange}
          onInputChange={onInputChange}
          onComposerModeChange={onComposerModeChange}
          onSend={onSend}
          onPickFiles={onPickFiles}
          onPickProduct={onPickProduct}
          onRemoveMedia={onRemoveMedia}
          onClearContext={onClearContext}
          onToggleRecording={onToggleRecording}
          onQuickReplySelect={onQuickReplySelect}
          onSuggestReply={onSuggestReply}
          onMessageAction={onMessageAction}
          onAddToCrm={onAddToCrm}
          onResolve={() => onStatusChange("resolved")}
          onResetForTesting={onResetForTesting}
          onLoadOlder={onLoadOlderMessages}
        />
      </div>

      {/* Desktop: resizable list/chat/profile panes, profile independently collapsible - the
          previous layout was a fixed-width flat flex row with no way to reclaim space from any
          pane. */}
      <div className="hidden min-h-0 min-w-0 flex-1 md:flex">
        <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 w-full">
          <ResizablePanel defaultSize={26} minSize={18} maxSize={40}>
            <ConversationList
              conversations={conversations}
              selectedId={selected?.id || ""}
              filter={filter}
              search={search}
              currentUserId={currentUserId}
              typingIds={typingIds}
              loading={loading}
              error={error}
              onSearchChange={onSearchChange}
              onSelect={onSelectConversation}
              onRetry={onRetryLoad}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={showProfile ? 52 : 74} minSize={30}>
            <div className="relative flex h-full min-w-0 flex-1">
              <ChatWindow
                conversation={selected}
                messages={selected?.messages || []}
                messageSearch={messageSearch}
                inputText={inputText}
                composerMode={composerMode}
                replyTo={replyTo}
                pendingMedia={pendingMedia}
                uploading={uploading}
                sendError={sendError}
                uploadById={uploadById}
                recording={recording}
                quickReplies={quickReplies}
                suggestingReply={suggestingReply}
                suggestReplyError={suggestReplyError}
                typing={selected ? typingIds.includes(selected.id) : false}
                crmSaving={crmSaving}
                isInCrm={Boolean(selectedMeta.isInCrm)}
                onBack={onBackToList}
                onMessageSearchChange={onMessageSearchChange}
                onInputChange={onInputChange}
                onComposerModeChange={onComposerModeChange}
                onSend={onSend}
                onPickFiles={onPickFiles}
                onPickProduct={onPickProduct}
                onRemoveMedia={onRemoveMedia}
                onClearContext={onClearContext}
                onToggleRecording={onToggleRecording}
                onQuickReplySelect={onQuickReplySelect}
                onSuggestReply={onSuggestReply}
                onMessageAction={onMessageAction}
                onAddToCrm={onAddToCrm}
                onResolve={() => onStatusChange("resolved")}
                onResetForTesting={onResetForTesting}
                onLoadOlder={onLoadOlderMessages}
              />
              {selected ? (
                <button
                  type="button"
                  onClick={() => setShowProfile((current) => !current)}
                  title={showProfile ? "Hide contact details" : "Show contact details"}
                  className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground shadow-sm backdrop-blur hover:border-primary/40 hover:text-primary"
                >
                  {showProfile ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                </button>
              ) : null}
            </div>
          </ResizablePanel>
          {selected && showProfile ? (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={22} minSize={16} maxSize={34}>
                <CustomerProfileSidebar
                  conversation={selected}
                  members={members}
                  savingCrm={crmSaving}
                  assigning={assigning}
                  onAssign={onAssign}
                  onStatusChange={onStatusChange}
                  onConversationSetting={onConversationSetting}
                  onAddToCrm={onAddToCrm}
                />
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
