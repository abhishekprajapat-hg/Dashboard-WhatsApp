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
import { SettingsView } from "./components/SettingsView";
import { clearToken, getEventStreamUrl, getStoredSession, getStoredToken, getUnreadCount, restoreSession, type ApiError, type AuthSession } from "./lib/api";

export default function App() {
  {/* MARKER-MAKE-KIT-INVOKED */}
  const [session, setSession] = useState<AuthSession | null>(null);
  const [booting, setBooting] = useState(true);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [contactChatTarget, setContactChatTarget] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
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

  function handleLogin(nextSession: AuthSession) {
    setSession(nextSession);
    setBooting(false);
  }

  function handleLogout() {
    clearToken();
    setSession(null);
    setUnreadCount(0);
  }

  function handleOpenContactChat(contactId: string) {
    setContactChatTarget(contactId);
    setActiveView("inbox");
  }

  if (booting) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-sm text-muted-foreground">
        Restoring session...
      </div>
    );
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background font-[Inter,system-ui,sans-serif]">
      <ActivityBar
        activeView={activeView}
        onViewChange={setActiveView}
        onLogout={handleLogout}
        unreadCount={unreadCount}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="h-9 border-b border-border flex items-center px-4 gap-2 shrink-0">
          <span className="text-xs text-muted-foreground capitalize">{activeView === "contacts" ? "CRM" : activeView}</span>
          <span className="text-xs text-muted-foreground">/</span>
          <span className="text-xs text-foreground">{session.workspace.name}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {session.user.name} - {session.user.role}
          </span>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {activeView === "dashboard" && <DashboardView userName={session.user.name} />}
          {activeView === "inbox" && <InboxView openContactId={contactChatTarget} onUnreadCountChange={setUnreadCount} />}
          {activeView === "contacts" && <ContactsView onOpenContactChat={handleOpenContactChat} />}
          {activeView === "automation" && <AutomationView />}
          {activeView === "campaigns" && <CampaignsView />}
          {activeView === "analytics" && <AnalyticsView />}
          {activeView === "team" && <TeamView />}
          {activeView === "settings" && <SettingsView />}
        </div>
      </main>
    </div>
  );
}


