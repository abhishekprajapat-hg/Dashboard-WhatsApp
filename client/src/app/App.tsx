import { useEffect, useState } from "react";
import { LoginPage } from "./components/LoginPage";
import { SignupPage } from "./components/SignupPage";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { DashboardView } from "./components/DashboardView";
import { InboxView } from "./components/InboxView";
import { ContactsView } from "./components/ContactsView";
import { LeadsView } from "./components/LeadsView";
import { AutomationView } from "./components/AutomationView";
import { TemplatesView } from "./components/TemplatesView";
import { CampaignsView } from "./components/CampaignsView";
import { AnalyticsView } from "./components/AnalyticsView";
import { MarketingView } from "./components/MarketingView";
import { DocumentsView } from "./components/DocumentsView";
import { InvoicingView } from "./components/InvoicingView";
import { ShippingView } from "./components/ShippingView";
import { SupportView } from "./components/SupportView";
import { TeamView } from "./components/TeamView";
import { TasksView } from "./components/TasksView";
import { AssistantView } from "./components/AssistantView";
import { AdminView } from "./components/AdminView";
import { SettingsView } from "./components/SettingsView";
import { ActionPasswordDialog } from "./components/ActionPasswordDialog";
import { clearToken, getEventStreamUrl, getStoredSession, getStoredToken, getUnreadCount, restoreSession, type ApiError, type AuthSession } from "./lib/api";
import { allowedViews, canAccessView, hasPermission, isPlatformOwner } from "./lib/permissions";
import { useTheme } from "./hooks/useTheme";
import { Sidebar } from "./components/shell/Sidebar";
import { TopBar } from "./components/shell/TopBar";
import { MobileNav } from "./components/shell/MobileNav";
import { CommandPalette } from "./components/shell/CommandPalette";
import { ShortcutsDialog, useGlobalShortcuts } from "./components/shell/shortcuts";
import type { ViewId } from "./components/shell/nav";

const APP_VIEWS: ViewId[] = ["dashboard", "inbox", "contacts", "leads", "automation", "templates", "campaigns", "analytics", "marketing", "invoicing", "shipping", "documents", "support", "team", "tasks", "assistant", "admin", "settings"];
const ACTIVE_VIEW_KEY = "whatscrm_active_view";
function isAppView(value: string | null): value is ViewId {
  return APP_VIEWS.includes(value as ViewId);
}

// Deep links: "#inbox/<contactId>" opens that customer's chat, "#leads/<leadId>" opens that lead.
// Plain "#view" works exactly as before.
function parseHash(hash = window.location.hash) {
  const [view = "", param = ""] = hash.replace(/^#\/?/, "").split("/");
  return { view, param: decodeURIComponent(param) };
}

function hashViewIs(view: ViewId) {
  return parseHash().view === view;
}

function initialHashParam(view: ViewId) {
  const parsed = parseHash();
  return parsed.view === view && parsed.param ? parsed.param : null;
}

function getInitialView(): ViewId {
  const hashView = parseHash().view;
  if (isAppView(hashView)) return hashView;

  const savedView = localStorage.getItem(ACTIVE_VIEW_KEY);
  if (isAppView(savedView)) return savedView;

  return startViewForRole(getStoredSession()?.user.roleKey);
}

// First screen for someone with no saved view: agents live in the inbox, everyone else starts on
// Today. After that, the app remembers the last screen as before.
function startViewForRole(roleKey?: string): ViewId {
  return roleKey === "agent" ? "inbox" : "dashboard";
}

const SIDEBAR_KEY = "nemnidhi_sidebar_collapsed";

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function formatRole(role: string) {
  return role.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function App() {
  // MARKER-MAKE-KIT-INVOKED
  const { theme, toggleTheme } = useTheme();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [booting, setBooting] = useState(true);
  const [authView, setAuthView] = useState<"login" | "signup">("login");
  const [showWhatsAppOnboarding, setShowWhatsAppOnboarding] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>(getInitialView);
  const [contactChatTarget, setContactChatTarget] = useState<string | null>(() => initialHashParam("inbox"));
  const [leadTarget, setLeadTarget] = useState<string | null>(() => initialHashParam("leads"));
  const [settingsTarget, setSettingsTarget] = useState<string | null>(() => initialHashParam("settings"));
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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
        if (error.status === 401) {
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
  const canWriteInbox = hasPermission(session, "inbox:write");
  const canWriteContacts = hasPermission(session, "contacts:write");
  const canWriteAutomation = hasPermission(session, "automation:write");
  const canWriteTemplates = hasPermission(session, "templates:write");
  const canWriteCampaigns = hasPermission(session, "campaigns:write");
  const canWriteTeam = hasPermission(session, "team:write");
  const canWriteTasks = hasPermission(session, "tasks:write");
  const canWriteMarketing = hasPermission(session, "marketing:write");
  const canWriteInvoicing = hasPermission(session, "invoicing:write");
  const canWriteShipping = hasPermission(session, "shipping:write");
  const canWriteDocuments = hasPermission(session, "assistant:write");
  const canWriteSupport = hasPermission(session, "inbox:write");
  const canWriteSettings = hasPermission(session, "settings:write");
  const isPlatformOwnerSession = isPlatformOwner(session);
  const workspaceName = session?.workspace?.name || "Workspace";
  const roleLabel = formatRole(session?.user.roleKey || session?.user.role || "User");

  useGlobalShortcuts({
    onOpenPalette: () => setPaletteOpen(true),
    onShowShortcuts: () => setShortcutsOpen(true),
    onNavigate: (view) => changeView(view),
    visibleViews: session ? visibleViews : [],
  });

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // just won't be remembered
      }
      return next;
    });
  }

  function changeView(view: ViewId) {
    setActiveView(view);
    localStorage.setItem(ACTIVE_VIEW_KEY, view);
    if (!hashViewIs(view)) {
      window.history.replaceState(null, "", `#${view}`);
    }
  }

  useEffect(() => {
    if (!session || visibleViews.length === 0 || canAccessView(session, activeView)) return;
    changeView(visibleViews[0]);
  }, [activeView, session, visibleViews]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_VIEW_KEY, activeView);
    if (!hashViewIs(activeView)) {
      window.history.replaceState(null, "", `#${activeView}`);
    }
  }, [activeView]);

  useEffect(() => {
    function handleHashChange() {
      const { view: nextView, param } = parseHash();
      if (!isAppView(nextView)) return;
      setActiveView(nextView);
      if (param && nextView === "inbox") setContactChatTarget(param);
      if (param && nextView === "leads") setLeadTarget(param);
      if (param && nextView === "settings") setSettingsTarget(param);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function handleLogin(nextSession: AuthSession) {
    setSession(nextSession);
    setBooting(false);
    // Only a brand-new signup (password/OAuth/WhatsApp OTP register, never a plain returning-user
    // login) gets the "connect your WhatsApp number" prompt - this is also the first real chance to
    // exercise Embedded Signup's success path against a genuinely unclaimed number.
    if (nextSession.isNewAccount) setShowWhatsAppOnboarding(true);
    if (!localStorage.getItem(ACTIVE_VIEW_KEY)) changeView(startViewForRole(nextSession.user.roleKey));
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
    return authView === "signup" ? (
      <SignupPage onSignup={handleLogin} onBackToLogin={() => setAuthView("login")} />
    ) : (
      <LoginPage onLogin={handleLogin} onRequestAccess={() => setAuthView("signup")} />
    );
  }

  if (showWhatsAppOnboarding) {
    return <OnboardingWizard workspaceName={session.workspace.name} onFinish={() => setShowWhatsAppOnboarding(false)} />;
  }

  return (
    <div className="relative flex h-dvh w-screen max-w-[100vw] overflow-hidden bg-background text-foreground">
      <Sidebar
        activeView={activeView}
        onViewChange={changeView}
        visibleViews={visibleViews}
        unreadCount={unreadCount}
        workspaceName={workspaceName}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        onOpenSearch={() => setPaletteOpen(true)}
      />

      <main className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <TopBar
          activeView={activeView}
          userName={session.user.name}
          userEmail={session.user.email}
          roleLabel={roleLabel}
          theme={theme}
          canOpenSettings={visibleViews.includes("settings")}
          onToggleTheme={toggleTheme}
          onOpenSearch={() => setPaletteOpen(true)}
          onShowShortcuts={() => setShortcutsOpen(true)}
          onOpenSettings={() => changeView("settings")}
          onLogout={handleLogout}
        />

        <div
          className={`min-h-0 flex-1 ${
            activeView === "inbox" ? "flex overflow-hidden" : "flex overflow-x-hidden overflow-y-auto"
          }`}
        >
          {!canAccessView(session, activeView) && (
            <div className="flex h-full flex-1 items-center justify-center p-6">
              <div className="rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-card">
                Your role doesn't include this screen. Ask a workspace admin if you need it.
              </div>
            </div>
          )}
          {canAccessView(session, activeView) && activeView === "dashboard" && <DashboardView
              userName={session.user.name}
              workspaceName={workspaceName}
              visibleViews={visibleViews}
              unreadCount={unreadCount}
              onNavigate={changeView}
              onOpenContact={handleOpenContactChat}
            />}
          {canAccessView(session, activeView) && activeView === "inbox" && <InboxView openContactId={contactChatTarget} currentUserId={session.user.id} canWrite={canWriteInbox} onUnreadCountChange={setUnreadCount} />}
          {canAccessView(session, activeView) && activeView === "contacts" && <ContactsView onOpenContactChat={handleOpenContactChat} canWrite={canWriteContacts} canSeeTasks={visibleViews.includes("tasks")} canSeeInvoices={visibleViews.includes("invoicing")} />}
          {canAccessView(session, activeView) && activeView === "leads" && <LeadsView
              canWrite={canWriteContacts}
              currentUserId={session.user.id}
              openLeadId={leadTarget}
              onLeadLinkHandled={() => setLeadTarget(null)}
              onOpenContact={visibleViews.includes("inbox") ? handleOpenContactChat : undefined}
            />}
          {canAccessView(session, activeView) && activeView === "automation" && <AutomationView canWrite={canWriteAutomation} />}
          {canAccessView(session, activeView) && activeView === "templates" && <TemplatesView canWrite={canWriteTemplates} />}
          {canAccessView(session, activeView) && activeView === "campaigns" && <CampaignsView canWrite={canWriteCampaigns} />}
          {canAccessView(session, activeView) && activeView === "analytics" && <AnalyticsView />}
          {canAccessView(session, activeView) && activeView === "marketing" && <MarketingView canWrite={canWriteMarketing} />}
          {canAccessView(session, activeView) && activeView === "invoicing" && <InvoicingView canWrite={canWriteInvoicing} />}
          {canAccessView(session, activeView) && activeView === "shipping" && <ShippingView canWrite={canWriteShipping} />}
          {canAccessView(session, activeView) && activeView === "documents" && <DocumentsView canWrite={canWriteDocuments} />}
          {canAccessView(session, activeView) && activeView === "support" && <SupportView canWrite={canWriteSupport} />}
          {canAccessView(session, activeView) && activeView === "team" && <TeamView canManage={canWriteTeam} />}
          {canAccessView(session, activeView) && activeView === "tasks" && <TasksView canWrite={canWriteTasks} />}
          {canAccessView(session, activeView) && activeView === "assistant" && <AssistantView />}
          {canAccessView(session, activeView) && activeView === "admin" && <AdminView isPlatformOwner={isPlatformOwnerSession} />}
          {canAccessView(session, activeView) && activeView === "settings" && <SettingsView canWrite={canWriteSettings} isPlatformOwner={isPlatformOwnerSession} initialTab={settingsTarget} />}
        </div>
      </main>

      <MobileNav activeView={activeView} onViewChange={changeView} visibleViews={visibleViews} unreadCount={unreadCount} onLogout={handleLogout} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        visibleViews={visibleViews}
        onNavigate={changeView}
        onOpenContact={handleOpenContactChat}
        theme={theme}
        onToggleTheme={toggleTheme}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onLogout={handleLogout}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} visibleViews={visibleViews} />
      {/* Mounted once at the root: api.ts triggers it on any 428 ACTION_PASSWORD_REQUIRED, whichever
          view the request came from, so no individual screen needs to know about it. */}
      <ActionPasswordDialog />
    </div>
  );
}


