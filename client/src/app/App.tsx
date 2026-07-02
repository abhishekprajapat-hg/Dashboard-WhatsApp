import { useEffect, useState } from "react";
import { LoginPage } from "./components/LoginPage";
import { ActivityBar, type ViewId } from "./components/ActivityBar";
import { DashboardView } from "./components/DashboardView";
import { InboxView } from "./components/InboxView";
import { ContactsView } from "./components/ContactsView";
import { AutomationView } from "./components/AutomationView";
import { CampaignsView } from "./components/CampaignsView";
import { AnalyticsView } from "./components/AnalyticsView";
import { TeamView } from "./components/TeamView";
import { AssistantView } from "./components/AssistantView";
import { AdminView } from "./components/AdminView";
import { SettingsView } from "./components/SettingsView";
import { clearToken, getEventStreamUrl, getStoredSession, getStoredToken, getUnreadCount, restoreSession, type ApiError, type AuthSession } from "./lib/api";
import { allowedViews, canAccessView, hasPermission } from "./lib/permissions";

const APP_VIEWS: ViewId[] = ["dashboard", "inbox", "contacts", "automation", "campaigns", "analytics", "team", "assistant", "admin", "settings"];

export default function App() {
  // MARKER-MAKE-KIT-INVOKED
  const [session, setSession] = useState<AuthSession | null>(null);
  const [booting, setBooting] = useState(true);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [contactChatTarget, setContactChatTarget] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    function handleInvalidAuth() {
      setSession(null);
      setUnreadCount(0);
      setContactChatTarget(null);
      setActiveView("dashboard");
    }

    window.addEventListener("auth:invalid", handleInvalidAuth);
    const cachedSession = getStoredSession();
    if (cachedSession) {
      setSession(cachedSession);
      setBooting(false);
    }

    if (!getStoredToken()) {
      setBooting(false);
      return;
    }

    restoreSession()
      .then(setSession)
      .catch((error: ApiError) => {
        if (error.status === 401 || error.status === 403) {
          clearToken();
          setSession(null);
        }
      })
      .finally(() => setBooting(false));

    return () => window.removeEventListener("auth:invalid", handleInvalidAuth);
  }, []);

  useEffect(() => {
    if (!session) return;

    function refreshUnread() {
      getUnreadCount<{ unread: number }>()
        .then((response) => setUnreadCount(response.unread))
        .catch(() => undefined);
    }

    refreshUnread();
    const events = new EventSource(getEventStreamUrl());
    events.addEventListener("conversation", refreshUnread);

    return () => events.close();
  }, [session]);

  const visibleViews = allowedViews(session, APP_VIEWS);
  const canWriteContacts = hasPermission(session, "contacts:write");
  const canWriteAutomation = hasPermission(session, "automation:write");
  const canWriteCampaigns = hasPermission(session, "campaigns:write");
  const canWriteTeam = hasPermission(session, "team:write");
  const canWriteSettings = hasPermission(session, "settings:write");
  const workspaceName = session?.workspace?.name || "Workspace";

  useEffect(() => {
    if (!session || visibleViews.length === 0 || canAccessView(session, activeView)) return;
    setActiveView(visibleViews[0]);
  }, [activeView, session, visibleViews]);

  function handleLogin(nextSession: AuthSession) {
    setSession(nextSession);
    setBooting(false);
  }

  function handleLogout() {
    clearToken();
    setSession(null);
    setUnreadCount(0);
    setContactChatTarget(null);
    setActiveView("dashboard");
  }

  function handleOpenContactChat(contactId: string) {
    setContactChatTarget(contactId);
    setActiveView("inbox");
  }

  if (booting) {
    return (
      <div className="h-dvh w-screen flex items-center justify-center bg-background text-sm text-muted-foreground">
        Restoring session...
      </div>
    );
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="h-dvh w-screen flex flex-col md:flex-row overflow-hidden bg-background font-[Inter,system-ui,sans-serif]">
      <ActivityBar
        activeView={activeView}
        onViewChange={setActiveView}
        onLogout={handleLogout}
        unreadCount={unreadCount}
        visibleViews={visibleViews}
      />

      <main className="min-h-0 flex-1 flex flex-col overflow-hidden pb-14 md:pb-0">
        <div className="min-h-9 border-b border-border flex items-center px-3 md:px-4 gap-2 shrink-0">
          <span className="text-xs text-muted-foreground capitalize">{activeView === "contacts" ? "CRM" : activeView}</span>
          <span className="text-xs text-muted-foreground">/</span>
          <span className="min-w-0 truncate text-xs text-foreground">{workspaceName}</span>
          <span className="ml-auto hidden sm:block truncate text-xs text-muted-foreground">
            {session.user.name} - {session.user.role}
          </span>
        </div>

        <div className="min-h-0 flex-1 flex overflow-hidden">
          {!canAccessView(session, activeView) && (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              You do not have access to this workspace view.
            </div>
          )}
          {canAccessView(session, activeView) && activeView === "dashboard" && <DashboardView userName={session.user.name} />}
          {canAccessView(session, activeView) && activeView === "inbox" && <InboxView openContactId={contactChatTarget} currentUserId={session.user.id} onUnreadCountChange={setUnreadCount} />}
          {canAccessView(session, activeView) && activeView === "contacts" && <ContactsView onOpenContactChat={handleOpenContactChat} canWrite={canWriteContacts} />}
          {canAccessView(session, activeView) && activeView === "automation" && <AutomationView canWrite={canWriteAutomation} />}
          {canAccessView(session, activeView) && activeView === "campaigns" && <CampaignsView canWrite={canWriteCampaigns} />}
          {canAccessView(session, activeView) && activeView === "analytics" && <AnalyticsView />}
          {canAccessView(session, activeView) && activeView === "team" && <TeamView canManage={canWriteTeam} />}
          {canAccessView(session, activeView) && activeView === "assistant" && <AssistantView />}
          {canAccessView(session, activeView) && activeView === "admin" && <AdminView />}
          {canAccessView(session, activeView) && activeView === "settings" && <SettingsView canWrite={canWriteSettings} />}
        </div>
      </main>
    </div>
  );
}


