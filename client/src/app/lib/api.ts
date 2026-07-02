export interface AuthSession {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    roleKey?: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    whatsappHealth: string;
  };
}

export type ApiError = Error & { status?: number };

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const TOKEN_KEY = "whatscrm_token";
const SESSION_KEY = "whatscrm_session";

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function getEventStreamUrl() {
  const token = getStoredToken();
  const baseUrl = API_URL.replace(/\/api\/?$/, "");
  return `${baseUrl}/api/events?token=${encodeURIComponent(token || "")}`;
}

export function storeToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function storeSession(session: AuthSession) {
  storeToken(session.token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.message || "Request failed.") as ApiError;
    error.status = response.status;
    throw error;
  }

  return payload as T;
}

export async function login(email: string, password: string) {
  const session = await request<AuthSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  storeSession(session);
  return session;
}

export async function restoreSession() {
  const session = await request<AuthSession>("/auth/me");
  storeSession(session);
  return session;
}

export function getDashboardSummary<T>() {
  return request<T>("/dashboard/summary");
}

export function getAdminOverview<T>() {
  return request<T>("/admin/overview");
}

export function updateAdminSettings<T>(settings: Record<string, unknown>) {
  return request<T>("/admin/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function getAssistantOverview<T>() {
  return request<T>("/assistant/overview");
}

export function analyzeAssistantConversation<T>(payload: {
  conversationId?: string;
  provider?: string;
  task?: string;
  prompt?: string;
}) {
  return request<T>("/assistant/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function searchAssistant<T>(query: string) {
  return request<T>(`/assistant/search?q=${encodeURIComponent(query)}`);
}

export function uploadKnowledgeDocument<T>(document: { name: string; content: string; mimeType?: string; source?: string }) {
  return request<T>("/assistant/knowledge", {
    method: "POST",
    body: JSON.stringify(document),
  });
}

export function transcribeAssistantVoice<T>(payload: { fileName?: string; transcript?: string }) {
  return request<T>("/assistant/voice/transcribe", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function runAssistantTool<T>(payload: { name: string; arguments?: Record<string, unknown>; conversationId?: string }) {
  return request<T>("/assistant/tool-call", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getApiBaseUrl() {
  return API_URL;
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("File could not be read."));
    reader.readAsDataURL(file);
  });
}

export function getAnalyticsSummary<T>(days = 14) {
  return request<T>(`/analytics/summary?days=${days}`);
}

export function getAnalyticsExportUrl(type: "pdf" | "excel", days = 30) {
  return `${API_URL}/analytics/export/${type}?days=${days}`;
}

export function getContacts<T>(search = "", lifecycle = "") {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (lifecycle) query.set("lifecycle", lifecycle);
  const suffix = query.toString() ? `?${query}` : "";
  return request<T>(`/contacts${suffix}`);
}

export function createContact<T>(contact: { name: string; phone: string; email?: string; tags?: string[] }) {
  return request<T>("/contacts", {
    method: "POST",
    body: JSON.stringify(contact),
  });
}

export function updateContact<T>(
  id: string,
  contact: { name: string; phone: string; email?: string; tags?: string[]; status?: string }
) {
  return request<T>(`/contacts/${id}`, {
    method: "PUT",
    body: JSON.stringify(contact),
  });
}

export function deleteContact(id: string) {
  return request<void>(`/contacts/${id}`, {
    method: "DELETE",
  });
}

export function getConversations<T>(params: { status?: string; search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  if ((params as { cursor?: string }).cursor) query.set("cursor", (params as { cursor?: string }).cursor || "");
  if ((params as { limit?: number }).limit) query.set("limit", String((params as { limit?: number }).limit));
  const suffix = query.toString() ? `?${query}` : "";
  return request<T>(`/conversations${suffix}`);
}

export function getConversationMessages<T>(conversationId: string, params: { before?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.before) query.set("before", params.before);
  if (params.limit) query.set("limit", String(params.limit));
  const suffix = query.toString() ? `?${query}` : "";
  return request<T>(`/conversations/${conversationId}/messages${suffix}`);
}

export function sendConversationMessage<T>(
  conversationId: string,
  content: string,
  options: { attachments?: { name: string; url: string; type?: string; mimeType?: string; size?: number }[]; replyToMessageId?: string } = {}
) {
  return request<T>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, ...options }),
  });
}

export function sendConversationMessageQueued<T>(
  conversationId: string,
  content: string,
  options: {
    attachments?: { name: string; url: string; type?: string; mimeType?: string; size?: number }[];
    replyToMessageId?: string;
    clientMessageId?: string;
  } = {}
) {
  return request<T>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, ...options }),
  });
}

export async function uploadMedia<T>(file: File) {
  const data = await fileToDataUrl(file);
  return request<T>("/media/upload", {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data,
    }),
  });
}

export async function uploadMediaWithProgress<T>(file: File, onProgress?: (progress: number) => void) {
  const data = await fileToDataUrl(file);
  const token = getStoredToken();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/media/upload`);
    xhr.setRequestHeader("Content-Type", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const payload = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(payload as T);
        return;
      }
      const error = new Error(payload.message || "Upload failed.") as ApiError;
      error.status = xhr.status;
      reject(error);
    };
    xhr.onerror = () => reject(new Error("Upload failed."));
    xhr.send(JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, data }));
  });
}

export function sendConversationNote<T>(conversationId: string, content: string) {
  return request<T>(`/conversations/${conversationId}/notes`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function sendConversationTemplate<T>(conversationId: string, templateId: string, parameters: string[] = []) {
  return request<T>(`/conversations/${conversationId}/template`, {
    method: "POST",
    body: JSON.stringify({ templateId, parameters }),
  });
}

export function assignConversation<T>(conversationId: string, userId: string) {
  return request<T>(`/conversations/${conversationId}/assignment`, {
    method: "PATCH",
    body: JSON.stringify({ userId }),
  });
}

export function addConversationToCrm<T>(conversationId: string) {
  return request<T>(`/conversations/${conversationId}/add-to-crm`, {
    method: "POST",
  });
}

export function getConversationByContact<T>(contactId: string) {
  return request<T>(`/conversations/by-contact/${contactId}`);
}

export function getUnreadCount<T>() {
  return request<T>("/conversations/unread-count");
}

export function markConversationRead<T>(conversationId: string) {
  return request<T>(`/conversations/${conversationId}/read`, {
    method: "PATCH",
  });
}

export function updateConversationSettings<T>(conversationId: string, settings: { pinned?: boolean; muted?: boolean }) {
  return request<T>(`/conversations/${conversationId}/settings`, {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function updateMessageReceipt<T>(conversationId: string, messageId: string, status: "delivered" | "read") {
  return request<T>(`/conversations/${conversationId}/messages/${messageId}/receipt`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function getMessageInfo<T>(conversationId: string, messageId: string) {
  return request<T>(`/conversations/${conversationId}/messages/${messageId}/info`);
}

export function updateMessageActions<T>(conversationId: string, messageId: string, actions: { pinned?: boolean; starred?: boolean }) {
  return request<T>(`/conversations/${conversationId}/messages/${messageId}/actions`, {
    method: "PATCH",
    body: JSON.stringify(actions),
  });
}

export function deleteConversationMessage(conversationId: string, messageId: string, mode: "me" | "everyone" = "everyone") {
  return request<void>(`/conversations/${conversationId}/messages/delete`, {
    method: "POST",
    body: JSON.stringify({ messageId, mode }),
  }).catch((error: ApiError) => {
    if (error.status === 404 || error.status === 405) {
      return request<void>(`/conversations/${conversationId}/messages/${messageId}/delete`, {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
    }
    throw error;
  });
}

export function updateConversationStatus<T>(conversationId: string, status: string) {
  return request<T>(`/conversations/${conversationId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function getSettings<T>() {
  return request<T>("/settings");
}

export function updateIntegrations<T>(integrations: {
  outboundWebhook?: { enabled?: boolean; url?: string; secret?: string };
  googleSheets?: { enabled?: boolean; webhookUrl?: string; secret?: string };
}) {
  return request<T>("/settings/integrations", {
    method: "PUT",
    body: JSON.stringify(integrations),
  });
}

export function testIntegrationWebhook<T>(payload: { url: string; secret?: string }) {
  return request<T>("/settings/integrations/test-webhook", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createWhatsAppAccount<T>(account: {
  provider?: string;
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken?: string;
  accountSid?: string;
  authToken?: string;
  apiKey?: string;
  apiBaseUrl?: string;
  tenantId?: string;
}) {
  return request<T>("/whatsapp/accounts", {
    method: "POST",
    body: JSON.stringify(account),
  });
}

export function deleteWhatsAppAccount(id: string) {
  return request<void>(`/whatsapp/accounts/${id}`, {
    method: "DELETE",
  });
}

export function syncWhatsAppTemplates<T>(id: string) {
  return request<T>(`/whatsapp/accounts/${id}/sync-templates`, {
    method: "POST",
  });
}

export function testWhatsAppAccount<T>(id: string) {
  return request<T>(`/whatsapp/accounts/${id}/test`, {
    method: "POST",
  });
}

export function getWhatsAppTemplates<T>() {
  return request<T>("/whatsapp/templates");
}

export function getWhatsAppConsole<T>() {
  return request<T>("/whatsapp/console");
}

export function createWhatsAppTemplate<T>(template: {
  accountId?: string;
  name: string;
  language?: string;
  category?: string;
  body?: string;
}) {
  return request<T>("/whatsapp/templates", {
    method: "POST",
    body: JSON.stringify(template),
  });
}

export function getCampaigns<T>() {
  return request<T>("/campaigns");
}

export function getCampaignReport<T>(id: string) {
  return request<T>(`/campaigns/${id}`);
}

export function createCampaign<T>(campaign: {
  name: string;
  type?: string;
  campaignKind?: string;
  audience?: string;
  audienceType?: string;
  templateId?: string;
  templateBId?: string;
  status?: string;
  scheduledAt?: string;
  recurring?: boolean;
  recurrence?: string;
  requireApproval?: boolean;
  rateLimit?: { perMinute?: number; batchSize?: number };
  abTest?: { enabled?: boolean; split?: number; winnerMetric?: string };
}) {
  return request<T>("/campaigns", {
    method: "POST",
    body: JSON.stringify(campaign),
  });
}

export function updateCampaign<T>(id: string, campaign: { name?: string; status?: string; type?: string; campaignKind?: string; audience?: string; audienceType?: string; templateId?: string; scheduledAt?: string; rateLimit?: { perMinute?: number; batchSize?: number } }) {
  return request<T>(`/campaigns/${id}`, {
    method: "PATCH",
    body: JSON.stringify(campaign),
  });
}

export function campaignAction<T>(id: string, action: string, payload: Record<string, unknown> = {}) {
  return request<T>(`/campaigns/${id}/action`, {
    method: "POST",
    body: JSON.stringify({ action, ...payload }),
  });
}

export function importCampaignContacts<T>(payload: { csv?: string; contacts?: { name?: string; phone: string; email?: string }[] }) {
  return request<T>("/campaigns/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function sendCampaign<T>(id: string) {
  return request<T>(`/campaigns/${id}/send`, {
    method: "POST",
  });
}

export function deleteCampaign(id: string) {
  return request<void>(`/campaigns/${id}`, {
    method: "DELETE",
  });
}

export function getAutomationFlows<T>() {
  return request<T>("/automation");
}

export function createAutomationFlow<T>(flow: {
  name: string;
  description?: string;
  trigger?: string;
  nodes?: unknown[];
  edges?: unknown[];
  category?: string;
  status?: string;
  actionMessage?: string;
  keyword?: string;
  sendReply?: boolean;
  assignmentUserId?: string;
  nextStatus?: string;
  tagName?: string;
  addToCrm?: boolean;
  callWebhook?: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
}) {
  return request<T>("/automation", {
    method: "POST",
    body: JSON.stringify(flow),
  });
}

export function updateAutomationFlow<T>(id: string, flow: { name?: string; status?: string }) {
  return request<T>(`/automation/${id}`, {
    method: "PATCH",
    body: JSON.stringify(flow),
  });
}

export function updateAutomationCanvas<T>(
  id: string,
  flow: { name?: string; status?: string; trigger?: unknown; nodes?: unknown[]; edges?: unknown[]; versionLabel?: string }
) {
  return request<T>(`/automation/${id}`, {
    method: "PATCH",
    body: JSON.stringify(flow),
  });
}

export function testAutomationFlow<T>(id: string, message: string) {
  return request<T>(`/automation/${id}/test`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function deleteAutomationFlow(id: string) {
  return request<void>(`/automation/${id}`, {
    method: "DELETE",
  });
}

export function getTeamMembers<T>() {
  return request<T>("/team");
}

export function inviteTeamMember<T>(member: { name?: string; email: string; role?: string; password?: string }) {
  return request<T>("/team", {
    method: "POST",
    body: JSON.stringify(member),
  });
}

export function updateTeamMember<T>(id: string, member: { role?: string }) {
  return request<T>(`/team/${id}`, {
    method: "PATCH",
    body: JSON.stringify(member),
  });
}

export function deleteTeamMember(id: string) {
  return request<void>(`/team/${id}`, {
    method: "DELETE",
  });
}

export function getCurrentWorkspace<T>() {
  return request<T>("/workspaces/current");
}

export function updateCurrentWorkspace<T>(workspace: { name?: string; timezone?: string; businessCategory?: string }) {
  return request<T>("/workspaces/current", {
    method: "PUT",
    body: JSON.stringify(workspace),
  });
}


