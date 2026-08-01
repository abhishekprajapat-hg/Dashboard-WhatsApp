export const demoSession = {
  token: "demo-token",
  user: {
    id: "usr_admin",
    name: "Admin",
    email: "admin@test.com",
    role: "Workspace Admin",
  },
  workspace: {
    id: "wsp_main",
    name: "Main Workspace",
    slug: "main-workspace",
    timezone: "Asia/Kolkata",
    whatsappHealth: "disconnected",
  },
};

interface DemoRecentConversation {
  name: string;
  phone: string;
  preview: string;
  status: string;
  time: string;
}

interface DemoTeamWorkloadMember {
  userId: string;
  name: string;
  role: string;
  lastActive: string;
  open: number;
  resolvedToday: number;
}

export const demoDashboard = {
  kpis: [
    { label: "Open conversations", value: "0", delta: "+0%" },
    { label: "New contacts today", value: "0", delta: "+0%" },
    { label: "Avg. response time", value: "0 min", delta: "+0%" },
    { label: "Resolution rate", value: "0%", delta: "+0%" },
  ],
  messageVolume: [
    { day: "Mon", inbound: 0, outbound: 0 },
    { day: "Tue", inbound: 0, outbound: 0 },
    { day: "Wed", inbound: 0, outbound: 0 },
    { day: "Thu", inbound: 0, outbound: 0 },
    { day: "Fri", inbound: 0, outbound: 0 },
    { day: "Sat", inbound: 0, outbound: 0 },
    { day: "Sun", inbound: 0, outbound: 0 },
  ],
  agentPerformance: [
    { name: "Admin", resolved: 0, avg: 0 },
  ],
  teamWorkload: [] as DemoTeamWorkloadMember[],
  recentConversations: [] as DemoRecentConversation[],
  health: {
    whatsapp: "disconnected",
    onlineAgents: 1,
    slaWarnings: 0,
  },
};

export const demoContacts = [];

export const demoConversations = [];
