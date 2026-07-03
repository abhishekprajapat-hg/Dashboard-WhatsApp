import { useEffect, useState } from "react";
import { LoginPage } from "./components/LoginPage";
import { ActivityBar, type ViewId } from "./components/ActivityBar";
import { DashboardView } from "./components/DashboardView";
import { InboxView } from "./components/InboxView";
import { ContactsView } from "./components/ContactsView";
import { AutomationView } from "./components/AutomationView";
import { TemplatesView } from "./components/TemplatesView";
import { CampaignsView } from "./components/CampaignsView";
import { AnalyticsView } from "./components/AnalyticsView";
import { TeamView } from "./components/TeamView";
import { AssistantView } from "./components/AssistantView";
import { AdminView } from "./components/AdminView";
import { SettingsView } from "./components/SettingsView";
import { clearToken, getEventStreamUrl, getStoredSession, getStoredToken, getUnreadCount, restoreSession, type ApiError, type AuthSession } from "./lib/api";
import { allowedViews, canAccessView, hasPermission } from "./lib/permissions";

const APP_VIEWS: ViewId[] = ["dashboard", "inbox", "contacts", "automation", "templates", "campaigns", "analytics", "team", "assistant", "admin", "settings"];
const ACTIVE_VIEW_KEY = "whatscrm_active_view";
const VIEW_LABELS: Record<ViewId, string> = {
  dashboard: "Dashboard",
  inbox: "Inbox",
  contacts: "CRM",
  automation: "Automation",
  templates: "Templates",
  campaigns: "Campaigns",
  analytics: "Analytics",
  team: "Team",
  assistant: "AI Assistant",
  admin: "Admin",
  settings: "Settings",
};

const VIEW_DESCRIPTIONS: Record<ViewId, string> = {
  dashboard: "Workspace command center",
  inbox: "Live WhatsApp conversations",
  contacts: "Customer records and lifecycle",
  automation: "Flows, triggers, and routing",
  templates: "Approved message templates",
  campaigns: "Broadcasts and audience sends",
  analytics: "Reports and performance",
  team: "Members, roles, and workload",
  assistant: "AI tools and conversation insights",
  admin: "Platform controls",
  settings: "Workspace and integrations",
};

function isAppView(value: string | null): value is ViewId {
  return APP_VIEWS.includes(value as ViewId);
}

function getInitialView(): ViewId {
  const hashView = window.location.hash.replace(/^#\/?/, "");
  if (isAppView(hashView)) return hashView;

  const savedView = localStorage.getItem(ACTIVE_VIEW_KEY);
  if (isAppView(savedView)) return savedView;

  return "dashboard";
}

function formatRole(role: string) {
  return role.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function App() {
  // MARKER-MAKE-KIT-INVOKED
  const [session, setSession] = useState<AuthSession | null>(null);
  const [booting, setBooting] = useState(true);
  const [activeView, setActiveView] = useState<ViewId>(getInitialView);
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
  const canWriteTemplates = hasPermission(session, "templates:write");
  const canWriteCampaigns = hasPermission(session, "campaigns:write");
  const canWriteTeam = hasPermission(session, "team:write");
  const canWriteSettings = hasPermission(session, "settings:write");
  const workspaceName = session?.workspace?.name || "Workspace";
  const activeLabel = VIEW_LABELS[activeView];
  const activeDescription = VIEW_DESCRIPTIONS[activeView];
  const roleLabel = formatRole(session?.user.roleKey || session?.user.role || "User");
  const userInitial = (session?.user.name || session?.user.email || "U").trim().charAt(0).toUpperCase();

  function changeView(view: ViewId) {
    setActiveView(view);
    localStorage.setItem(ACTIVE_VIEW_KEY, view);
    if (window.location.hash !== `#${view}`) {
      window.history.replaceState(null, "", `#${view}`);
    }
  }

  useEffect(() => {
    if (!session || visibleViews.length === 0 || canAccessView(session, activeView)) return;
    changeView(visibleViews[0]);
  }, [activeView, session, visibleViews]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_VIEW_KEY, activeView);
    if (window.location.hash !== `#${activeView}`) {
      window.history.replaceState(null, "", `#${activeView}`);
    }
  }, [activeView]);

  useEffect(() => {
    function handleHashChange() {
      const nextView = window.location.hash.replace(/^#\/?/, "");
      if (isAppView(nextView)) setActiveView(nextView);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function handleLogin(nextSession: AuthSession) {
    setSession(nextSession);
    setBooting(false);
  }

  function handleLogout() {
    clearToken();
    setSession(null);
    setUnreadCount(0);
    setContactChatTarget(null);
    changeView("dashboard");
  }

  function handleOpenContactChat(contactId: string) {
    setContactChatTarget(contactId);
    changeView("inbox");
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
    <div className="relative flex h-dvh w-screen max-w-[100vw] flex-col overflow-hidden bg-background font-[Inter,system-ui,sans-serif] text-foreground md:flex-row">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_-10%,rgba(37,211,102,0.12),transparent_28rem),radial-gradient(circle_at_86%_0%,rgba(79,140,255,0.1),transparent_26rem)]" />
      <div className="pointer-events-none absolute inset-y-0 left-[72px] hidden w-px bg-gradient-to-b from-transparent via-primary/20 to-transparent md:block" />
      <ActivityBar
        activeView={activeView}
        onViewChange={changeView}
        onLogout={handleLogout}
        unreadCount={unreadCount}
        visibleViews={visibleViews}
      />

      <main className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="flex min-h-[64px] shrink-0 items-center gap-3 border-b border-border/80 bg-surface/72 px-3 backdrop-blur-xl sm:px-4 lg:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <span className="max-w-[44vw] truncate sm:max-w-xs">{workspaceName}</span>
              <span className="text-border">/</span>
              <span className="truncate text-foreground">{activeLabel}</span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold leading-none text-foreground sm:text-lg">{activeLabel}</h1>
              <span className="hidden rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary sm:inline-flex">
                Live workspace
              </span>
              <p className="hidden truncate text-xs text-muted-foreground md:block">{activeDescription}</p>
            </div>
          </div>

          <div className="hidden min-w-0 items-center gap-3 rounded-lg border border-border/80 bg-card/70 px-3 py-2 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] sm:flex">
            <div className="min-w-0 text-right">
              <div className="truncate text-xs font-medium text-foreground">{session.user.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">{roleLabel}</div>
            </div>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
              {userInitial}
            </div>
          </div>

          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-xs font-semibold text-primary sm:hidden">
            {userInitial}
          </div>
        </div>

        <div
          className={`min-h-0 flex-1 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),transparent_220px)] ${
            activeView === "inbox" ? "flex overflow-hidden" : "flex overflow-x-hidden overflow-y-auto"
          }`}
        >
          {!canAccessView(session, activeView) && (
            <div className="flex h-full flex-1 items-center justify-center p-6">
              <div className="rounded-lg border border-border/80 bg-card/80 px-5 py-4 text-sm text-muted-foreground shadow-2xl shadow-black/20">
                You do not have access to this workspace view.
              </div>
            </div>
          )}
          {canAccessView(session, activeView) && activeView === "dashboard" && <DashboardView userName={session.user.name} />}
          {canAccessView(session, activeView) && activeView === "inbox" && <InboxView openContactId={contactChatTarget} currentUserId={session.user.id} onUnreadCountChange={setUnreadCount} />}
          {canAccessView(session, activeView) && activeView === "contacts" && <ContactsView onOpenContactChat={handleOpenContactChat} canWrite={canWriteContacts} />}
          {canAccessView(session, activeView) && activeView === "automation" && <AutomationView canWrite={canWriteAutomation} />}
          {canAccessView(session, activeView) && activeView === "templates" && <TemplatesView canWrite={canWriteTemplates} />}
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


