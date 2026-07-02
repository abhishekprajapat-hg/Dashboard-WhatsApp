import type { Conversation, InboxFilter, PendingMedia, TeamMember, WhatsAppMessage } from "./types";
import { ChatWindow } from "./ChatWindow";
import { ConversationList } from "./ConversationList";
import { CustomerProfileSidebar } from "./CustomerProfileSidebar";
import { InboxSidebar } from "./InboxSidebar";
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
  recording: boolean;
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
  onRemoveMedia: (index: number) => void;
  onClearContext: () => void;
  onToggleRecording: () => void;
  onMessageAction: (action: "reply" | "copy" | "forward" | "star" | "delete" | "retry" | "download", message: WhatsAppMessage) => void;
  onAssign: (userId: string) => void;
  onStatusChange: (status: Conversation["status"]) => void;
  onConversationSetting: (settings: { pinned?: boolean; muted?: boolean }) => void;
  onLoadOlderMessages: () => void;
  onAddToCrm: (stage?: string) => void;
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
  recording,
  crmSaving,
  assigning,
  mobileChatOpen,
  loading,
  error,
  onFilterChange,
  onSearchChange,
  onMessageSearchChange,
  onSelectConversation,
  onRetryLoad,
  onBackToList,
  onInputChange,
  onComposerModeChange,
  onSend,
  onPickFiles,
  onRemoveMedia,
  onClearContext,
  onToggleRecording,
  onMessageAction,
  onAssign,
  onStatusChange,
  onConversationSetting,
  onLoadOlderMessages,
  onAddToCrm,
}: WhatsAppBusinessInboxProps) {
  const selected = conversations.find((conversation) => conversation.id === selectedId) || conversations[0];
  const selectedMeta = selected ? conversationMeta(selected) : { isInCrm: false };
  const unreadCount = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-zinc-100 text-zinc-950 dark:bg-[#0b141a] dark:text-zinc-50">
      <InboxSidebar
        activeFilter={filter}
        search={search}
        unreadCount={unreadCount}
        onFilterChange={onFilterChange}
        onSearchChange={onSearchChange}
      />

      <div className={mobileChatOpen ? "hidden md:flex" : "flex"}>
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

      <div className={mobileChatOpen ? "flex min-w-0 flex-1" : "hidden min-w-0 flex-1 md:flex"}>
        <ChatWindow
          conversation={selected}
          messages={selected?.messages || []}
          messageSearch={messageSearch}
          inputText={inputText}
          composerMode={composerMode}
          replyTo={replyTo}
          pendingMedia={pendingMedia}
          uploading={uploading}
          recording={recording}
          typing={selected ? typingIds.includes(selected.id) : false}
          crmSaving={crmSaving}
          isInCrm={Boolean(selectedMeta.isInCrm)}
          onBack={onBackToList}
          onMessageSearchChange={onMessageSearchChange}
          onInputChange={onInputChange}
          onComposerModeChange={onComposerModeChange}
          onSend={onSend}
          onPickFiles={onPickFiles}
          onRemoveMedia={onRemoveMedia}
          onClearContext={onClearContext}
          onToggleRecording={onToggleRecording}
          onMessageAction={onMessageAction}
          onAddToCrm={onAddToCrm}
          onResolve={() => onStatusChange("resolved")}
          onLoadOlder={onLoadOlderMessages}
        />

        {selected ? (
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
        ) : null}
      </div>
    </div>
  );
}
