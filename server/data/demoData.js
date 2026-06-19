export const demoUser = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@test.com",
  role: "Workspace Admin",
};

export const demoWorkspace = {
  id: "wsp_main",
  name: "Main Workspace",
  slug: "main-workspace",
  timezone: "Asia/Kolkata",
  whatsappHealth: "disconnected",
};

export const contacts = [];

export const conversations = [];

export const dashboardSummary = {
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
};
