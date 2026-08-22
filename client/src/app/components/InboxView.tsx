import { useEffect, useRef, useState } from "react";
import { WhatsAppBusinessInbox } from "./whatsapp-inbox/WhatsAppBusinessInbox";
import { useWhatsAppEngine } from "./whatsapp-inbox/hooks/useWhatsAppEngine";
import { analyzeAssistantConversation, getTemplates, markTemplateUsed } from "../lib/api";
import { isPlanLimitError } from "./PlanLockedState";

interface QuickReplyTemplate {
  id: string;
  name: string;
  body: string;
}

interface InboxViewProps {
  openContactId?: string | null;
  currentUserId?: string;
  canWrite?: boolean;
  onUnreadCountChange?: (count: number) => void;
}

export function InboxView({ openContactId, currentUserId, canWrite = false, onUnreadCountChange }: InboxViewProps) {
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const engine = useWhatsAppEngine({ openContactId, currentUserId, canWrite, onUnreadCountChange });
  const [quickReplies, setQuickReplies] = useState<QuickReplyTemplate[]>([]);
  const [suggestingReply, setSuggestingReply] = useState(false);
  const [suggestReplyError, setSuggestReplyError] = useState("");

  useEffect(() => {
    getTemplates<{ data: QuickReplyTemplate[] }>({ type: "quick_reply", status: "active" })
      .then((response) => setQuickReplies(response.data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setSuggestReplyError("");
  }, [engine.selected?.id]);

  function pickFiles(kind: "media" | "document" | "audio") {
    if (kind === "document") documentInputRef.current?.click();
    else if (kind === "audio") audioInputRef.current?.click();
    else mediaInputRef.current?.click();
  }

  function applyQuickReply(template: QuickReplyTemplate) {
    const nextValue = engine.inputText.trim()
      ? `${engine.inputText.trim()}\n${template.body}`
      : template.body;
    engine.handleTyping(nextValue);
    markTemplateUsed(template.id).catch(() => undefined);
  }

  async function suggestReply() {
    if (!engine.selected?.id) return;
    setSuggestingReply(true);
    setSuggestReplyError("");
    try {
      const response = await analyzeAssistantConversation<{ data: { autoReply: string } }>({
        conversationId: engine.selected.id,
        task: "draft_reply",
      });
      engine.handleTyping(response.data.autoReply);
    } catch (error) {
      setSuggestReplyError(
        isPlanLimitError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : "Could not suggest a reply.",
      );
    } finally {
      setSuggestingReply(false);
    }
  }

  return (
    <>
      <input
        ref={mediaInputRef}
        type="file"
        multiple
        accept="image/*,video/*,.gif"
        className="hidden"
        onChange={(event) => {
          engine.addMediaFiles(Array.from(event.target.files || []));
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf,text/plain"
        className="hidden"
        onChange={(event) => {
          engine.addMediaFiles(Array.from(event.target.files || []));
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
          engine.addMediaFiles(Array.from(event.target.files || []));
          event.currentTarget.value = "";
        }}
      />

      <WhatsAppBusinessInbox
        conversations={engine.conversations}
        selectedId={engine.selected?.id || ""}
        filter={engine.store.filter}
        search={engine.store.search}
        messageSearch={engine.messageSearch}
        currentUserId={currentUserId}
        typingIds={engine.store.typingConversationIds}
        members={engine.members}
        inputText={engine.inputText}
        composerMode={engine.composerMode}
        replyTo={engine.replyTo}
        pendingMedia={engine.pendingMedia}
        uploading={engine.uploading}
        sendError={engine.sendError}
        uploadById={engine.store.uploadById}
        recording={engine.recording}
        quickReplies={quickReplies}
        suggestingReply={suggestingReply}
        suggestReplyError={suggestReplyError}
        crmSaving={engine.crmSaving}
        assigning={engine.assigning}
        mobileChatOpen={engine.store.mobileChatOpen}
        loading={engine.store.loading}
        error={engine.store.error}
        onFilterChange={engine.store.setFilter}
        onSearchChange={engine.store.setSearch}
        onMessageSearchChange={engine.setMessageSearch}
        onSelectConversation={engine.store.selectConversation}
        onRetryLoad={engine.loadConversations}
        onBackToList={() => engine.store.setMobileChatOpen(false)}
        onInputChange={engine.handleTyping}
        onComposerModeChange={engine.setComposerMode}
        onSend={engine.handleSend}
        onPickFiles={pickFiles}
        onRemoveMedia={engine.removePendingMedia}
        onClearContext={engine.clearDraftContext}
        onToggleRecording={() => engine.setRecording((value) => !value)}
        onQuickReplySelect={applyQuickReply}
        onSuggestReply={suggestReply}
        onMessageAction={engine.handleMessageAction}
        onAssign={engine.handleAssign}
        onStatusChange={engine.handleStatusChange}
        onConversationSetting={engine.handleConversationSetting}
        onLoadOlderMessages={engine.loadOlderMessages}
        onAddToCrm={engine.handleAddToCrm}
      />
    </>
  );
}
