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
  const suffix = query.toString() ? `?${query}` : "";
  return request<T>(`/conversations${suffix}`);
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

export function getMessageInfo<T>(conversationId: string, messageId: string) {
  return request<T>(`/conversations/${conversationId}/messages/${messageId}/info`);
}

export function updateMessageActions<T>(conversationId: string, messageId: string, actions: { pinned?: boolean; starred?: boolean }) {
  return request<T>(`/conversations/${conversationId}/messages/${messageId}/actions`, {
    method: "PATCH",
    body: JSON.stringify(actions),
  });
}

export function deleteConversationMessage(conversationId: string, messageId: string) {
  return request<void>(`/conversations/${conversationId}/messages/${messageId}`, {
    method: "DELETE",
  }).catch((error: ApiError) => {
    if (error.status === 404 || error.status === 405) {
      return request<void>(`/conversations/${conversationId}/messages/${messageId}/delete`, {
        method: "POST",
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
  audience?: string;
  audienceType?: string;
  templateId?: string;
  status?: string;
  scheduledAt?: string;
}) {
  return request<T>("/campaigns", {
    method: "POST",
    body: JSON.stringify(campaign),
  });
}

export function updateCampaign<T>(id: string, campaign: { name?: string; status?: string; type?: string; audience?: string; audienceType?: string; templateId?: string }) {
  return request<T>(`/campaigns/${id}`, {
    method: "PATCH",
    body: JSON.stringify(campaign),
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


