import { sendConversationMessageQueued } from "../../../lib/api";
import type { Attachment, QueuedMessage, WhatsAppMessage } from "../types";

interface SendResponse {
  data: WhatsAppMessage;
}

interface QueueHandlers {
  onQueued: (message: QueuedMessage) => void;
  onSending: (message: QueuedMessage) => void;
  onSent: (message: QueuedMessage, response: WhatsAppMessage) => void;
  onFailed: (message: QueuedMessage, error: Error) => void;
}

class MessageQueue {
  private queue: QueuedMessage[] = [];
  private running = false;

  enqueue(input: {
    conversationId: string;
    content: string;
    replyToMessageId?: string;
    attachments: Attachment[];
    clientMessageId: string;
  }, handlers: QueueHandlers) {
    const queued: QueuedMessage = {
      id: input.clientMessageId,
      conversationId: input.conversationId,
      content: input.content,
      replyToMessageId: input.replyToMessageId,
      attachments: input.attachments,
      attempts: 0,
      status: "queued",
    };
    this.queue.push(queued);
    handlers.onQueued(queued);
    void this.flush(handlers);
    return queued;
  }

  async retry(message: QueuedMessage, handlers: QueueHandlers) {
    this.queue.unshift({ ...message, status: "queued" });
    handlers.onQueued(message);
    await this.flush(handlers);
  }

  private async flush(handlers: QueueHandlers) {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const message = this.queue.shift()!;
      const sending = { ...message, attempts: message.attempts + 1, status: "sending" as const };
      handlers.onSending(sending);
      try {
        const response = await sendConversationMessageQueued<SendResponse>(message.conversationId, message.content, {
          attachments: message.attachments,
          replyToMessageId: message.replyToMessageId,
          clientMessageId: message.id,
        });
        handlers.onSent(sending, response.data);
      } catch (error) {
        handlers.onFailed({ ...sending, status: "failed" }, error instanceof Error ? error : new Error("Message failed"));
      }
    }
    this.running = false;
  }
}

export const messageQueue = new MessageQueue();
