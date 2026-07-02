import { DragEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Activity,
  AlarmClock,
  Bot,
  Braces,
  CalendarDays,
  CheckCircle2,
  Code2,
  Copy,
  Database,
  Diamond,
  GitBranch,
  Globe2,
  History,
  Hourglass,
  Mail,
  Map,
  MessageCircle,
  MousePointer2,
  Network,
  Play,
  Plus,
  RefreshCcw,
  Save,
  ScrollText,
  Send,
  Sheet,
  Sparkles,
  Tag,
  Trash2,
  UserRoundPlus,
  Variable,
  Webhook,
  Zap,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  createAutomationFlow,
  deleteAutomationFlow,
  getAutomationFlows,
  testAutomationFlow,
  updateAutomationCanvas,
  updateAutomationFlow,
} from "../lib/api";

type FlowStatus = "active" | "inactive" | "draft";

interface Flow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  keyword: string;
  keywords?: string[];
  actionSummary: string[];
  actions: number;
  status: FlowStatus;
  runs: number;
  lastRun: string;
  category: string;
  nodes?: ServerNode[];
  edges?: Edge[];
  version?: number;
  analytics?: { runs: number; completionRate: number; errorRate: number; lastRunAt?: string };
  versions?: { version: number; label: string; at: string }[];
  executionLogs?: { at: string; level: string; message: string; nodeId?: string }[];
}

interface ServerNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  config?: Record<string, unknown>;
}

interface TestResult {
  matched: boolean;
  message: string;
  actions: { flowId: string; type: string; status?: string; tag?: string; messageId?: string; error?: string }[];
  flow?: Flow;
}

type AutomationNodeData = {
  kind: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  config: Record<string, unknown>;
};

const statusStyle: Record<string, string> = {
  active: "bg-primary/20 text-primary border-primary/30",
  inactive: "bg-secondary text-muted-foreground border-border",
  draft: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const nodeCatalog = [
  { kind: "trigger", label: "Trigger", icon: "Zap", color: "#22c55e", description: "Start from inbound events" },
  { kind: "delay", label: "Delay", icon: "Hourglass", color: "#f59e0b", description: "Wait before next action" },
  { kind: "condition", label: "Condition", icon: "Diamond", color: "#38bdf8", description: "Route by fields" },
  { kind: "keyword", label: "Keyword", icon: "Tag", color: "#84cc16", description: "Match incoming text" },
  { kind: "if_else", label: "If Else", icon: "GitBranch", color: "#06b6d4", description: "Branch workflow" },
  { kind: "call_webhook", label: "Webhook", icon: "Webhook", color: "#f97316", description: "Send webhook event" },
  { kind: "api", label: "API", icon: "Globe2", color: "#3b82f6", description: "Call an API" },
  { kind: "add_to_crm", label: "CRM", icon: "Database", color: "#10b981", description: "Create/update CRM" },
  { kind: "google_sheets", label: "Google Sheets", icon: "Sheet", color: "#22c55e", description: "Append a sheet row" },
  { kind: "openai", label: "OpenAI", icon: "Sparkles", color: "#a855f7", description: "Generate AI response" },
  { kind: "claude", label: "Claude", icon: "Bot", color: "#8b5cf6", description: "Claude reasoning step" },
  { kind: "gemini", label: "Gemini", icon: "Sparkles", color: "#6366f1", description: "Gemini generation step" },
  { kind: "email", label: "Email", icon: "Mail", color: "#0ea5e9", description: "Send email" },
  { kind: "sms", label: "SMS", icon: "Send", color: "#14b8a6", description: "Send SMS" },
  { kind: "send_message", label: "WhatsApp Send", icon: "MessageCircle", color: "#22c55e", description: "Send WhatsApp message" },
  { kind: "assign_user", label: "Assign Agent", icon: "UserRoundPlus", color: "#f43f5e", description: "Assign owner" },
  { kind: "add_tag", label: "Tag User", icon: "Tag", color: "#eab308", description: "Apply label" },
  { kind: "lead_stage", label: "Lead Stage", icon: "Activity", color: "#06b6d4", description: "Move CRM stage" },
  { kind: "task", label: "Task", icon: "CheckCircle2", color: "#a3e635", description: "Create task" },
  { kind: "calendar", label: "Calendar", icon: "CalendarDays", color: "#f97316", description: "Create event" },
  { kind: "http_request", label: "HTTP Request", icon: "Globe2", color: "#60a5fa", description: "Advanced HTTP call" },
  { kind: "loop", label: "Loop", icon: "RefreshCcw", color: "#facc15", description: "Iterate over items" },
  { kind: "variables", label: "Variables", icon: "Variable", color: "#c084fc", description: "Set variables" },
  { kind: "json_parser", label: "JSON Parser", icon: "Braces", color: "#818cf8", description: "Parse JSON payload" },
  { kind: "code_block", label: "Code Block", icon: "Code2", color: "#94a3b8", description: "Run custom logic" },
  { kind: "sub_workflow", label: "Sub Workflow", icon: "Network", color: "#fb7185", description: "Call another flow" },
];

const templates = [
  { name: "Inbound Lead Capture", nodes: ["Trigger", "CRM", "Assign Agent", "WhatsApp Send"] },
  { name: "Missed Call Follow Up", nodes: ["Trigger", "Delay", "WhatsApp Send", "Task"] },
  { name: "AI Qualification", nodes: ["Keyword", "OpenAI", "Lead Stage", "Google Sheets"] },
  { name: "Payment Reminder", nodes: ["Trigger", "Condition", "WhatsApp Send", "Calendar"] },
];

function iconFor(name: string, size = 15) {
  const icons: Record<string, React.ReactNode> = {
    Activity: <Activity size={size} />,
    AlarmClock: <AlarmClock size={size} />,
    Bot: <Bot size={size} />,
    Braces: <Braces size={size} />,
    CalendarDays: <CalendarDays size={size} />,
    CheckCircle2: <CheckCircle2 size={size} />,
    Code2: <Code2 size={size} />,
    Database: <Database size={size} />,
    Diamond: <Diamond size={size} />,
    GitBranch: <GitBranch size={size} />,
    Globe2: <Globe2 size={size} />,
    Hourglass: <Hourglass size={size} />,
    Mail: <Mail size={size} />,
    MessageCircle: <MessageCircle size={size} />,
    Network: <Network size={size} />,
    RefreshCcw: <RefreshCcw size={size} />,
    Send: <Send size={size} />,
    Sheet: <Sheet size={size} />,
    Sparkles: <Sparkles size={size} />,
    Tag: <Tag size={size} />,
    UserRoundPlus: <UserRoundPlus size={size} />,
    Variable: <Variable size={size} />,
    Webhook: <Webhook size={size} />,
    Zap: <Zap size={size} />,
  };
  return icons[name] || <Zap size={size} />;
}

function catalogFor(kind: string) {
  return nodeCatalog.find((node) => node.kind === kind) || nodeCatalog[0];
}

function AutomationNode({ data, selected }: NodeProps<Node<AutomationNodeData>>) {
  return (
    <div className={`w-[210px] rounded-md border bg-card shadow-sm transition ${selected ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded" style={{ backgroundColor: `${data.color}22`, color: data.color }}>
          {iconFor(data.icon)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">{data.label}</div>
          <div className="truncate text-[10px] text-muted-foreground">{data.kind.replace(/_/g, " ")}</div>
        </div>
      </div>
      <div className="space-y-2 px-3 py-2">
        <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{data.description}</p>
        <div className="flex flex-wrap gap-1">
          {Object.entries(data.config || {}).slice(0, 2).map(([key, value]) => (
            <span key={key} className="max-w-full truncate rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {key}: {String(value || "-")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function serverNodeToCanvas(node: ServerNode, index: number): Node<AutomationNodeData> {
  const item = catalogFor(node.type);
  return {
    id: node.id,
    type: "automation",
    position: node.position || { x: 80 + index * 260, y: 160 },
    data: {
      kind: node.type,
      label: item.label,
      description: item.description,
      icon: item.icon,
      color: item.color,
      config: node.config || {},
    },
  };
}

function canvasNodeToServer(node: Node<AutomationNodeData>): ServerNode {
  return {
    id: node.id,
    type: node.data.kind,
    position: node.position,
    config: node.data.config || {},
  };
}

function defaultNodes(): Node<AutomationNodeData>[] {
  return [
    serverNodeToCanvas({ id: "trigger", type: "trigger", position: { x: 80, y: 160 }, config: { event: "New conversation" } }, 0),
    serverNodeToCanvas({ id: "send_message_1", type: "send_message", position: { x: 360, y: 160 }, config: { body: "Thanks for reaching out." } }, 1),
  ];
}

function defaultEdges(): Edge[] {
  return [{ id: "trigger-send_message_1", source: "trigger", target: "send_message_1", animated: true }];
}

function BuilderCanvas({
  selectedFlow,
  onFlowSaved,
}: {
  selectedFlow?: Flow;
  onFlowSaved: (flow: Flow) => void;
}) {
  const reactFlow = useReactFlow();
  const [nodes, setNodes] = useState<Node<AutomationNodeData>[]>(defaultNodes);
  const [edges, setEdges] = useState<Edge[]>(defaultEdges);
  const [selectedNodeId, setSelectedNodeId] = useState("trigger");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState("price");
  const [testResult, setTestResult] = useState<TestResult | { error: string } | null>(null);
  const [debugMode, setDebugMode] = useState(true);

  useEffect(() => {
    if (!selectedFlow) return;
    setNodes(selectedFlow.nodes?.length ? selectedFlow.nodes.map(serverNodeToCanvas) : defaultNodes());
    setEdges(selectedFlow.edges?.length ? selectedFlow.edges : defaultEdges());
    setSelectedNodeId(selectedFlow.nodes?.[0]?.id || "trigger");
    setTestResult(null);
  }, [selectedFlow?.id]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((items) => applyNodeChanges(changes, items)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((items) => applyEdgeChanges(changes, items)), []);
  const onConnect = useCallback((connection: Connection) => {
    setEdges((items) => addEdge({ ...connection, animated: true }, items));
  }, []);

  function onDragStart(event: DragEvent, kind: string) {
    event.dataTransfer.setData("application/automation-node", kind);
    event.dataTransfer.effectAllowed = "move";
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/automation-node");
    if (!kind) return;
    const item = catalogFor(kind);
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const id = `${kind}_${Date.now()}`;
    const node: Node<AutomationNodeData> = {
      id,
      type: "automation",
      position,
      data: { kind, label: item.label, description: item.description, icon: item.icon, color: item.color, config: {} },
    };
    setNodes((items) => [...items, node]);
    setSelectedNodeId(id);
  }

  function updateSelectedConfig(key: string, value: string) {
    if (!selectedNode) return;
    setNodes((items) =>
      items.map((node) =>
        node.id === selectedNode.id
          ? { ...node, data: { ...node.data, config: { ...node.data.config, [key]: value } } }
          : node
      )
    );
  }

  async function saveCanvas(status?: FlowStatus) {
    setSaving(true);
    try {
      const payload = {
        name: selectedFlow?.name || "Visual Automation Flow",
        status: status || selectedFlow?.status || "draft",
        trigger: {
          type: "visual",
          label: "Visual workflow",
          description: selectedFlow?.description || "Visual automation builder flow",
          category: selectedFlow?.category || "Visual",
          keyword: "",
          keywords: [],
          runs: selectedFlow?.runs || 0,
          versions: selectedFlow?.versions || [],
          executionLogs: selectedFlow?.executionLogs || [],
        },
        nodes: nodes.map(canvasNodeToServer),
        edges,
      };
      const response = selectedFlow
        ? await updateAutomationCanvas<{ data: Flow }>(selectedFlow.id, {
            name: payload.name,
            status: payload.status,
            nodes: payload.nodes,
            edges: payload.edges,
            versionLabel: "Visual canvas save",
          })
        : await createAutomationFlow<{ data: Flow }>(payload);
      onFlowSaved(response.data);
    } finally {
      setSaving(false);
    }
  }

  async function testFlow() {
    if (!selectedFlow) {
      await saveCanvas("active");
      return;
    }
    setTesting(true);
    try {
      const response = await testAutomationFlow<TestResult>(selectedFlow.id, testMessage);
      setTestResult(response);
      if (response.flow) onFlowSaved(response.flow);
    } catch (error) {
      setTestResult({ error: error instanceof Error ? error.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_330px] overflow-hidden">
      <aside className="no-scrollbar border-r border-border bg-card/60 p-3 overflow-y-auto">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">Node Library</div>
            <div className="text-[11px] text-muted-foreground">Drag onto canvas</div>
          </div>
          <MousePointer2 size={16} className="text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          {nodeCatalog.map((item) => (
            <button
              key={item.kind}
              draggable
              onDragStart={(event) => onDragStart(event, item.kind)}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-2 text-left transition hover:border-primary/40 hover:bg-secondary"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded" style={{ backgroundColor: `${item.color}22`, color: item.color }}>
                {iconFor(item.icon)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-foreground">{item.label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="relative min-w-0 bg-[#0b0f14]">
        <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-black/50 p-2 backdrop-blur">
          <Button size="sm" className="h-8 bg-primary text-xs text-primary-foreground" onClick={() => saveCanvas()} disabled={saving}>
            <Save size={13} className="mr-1" /> {saving ? "Saving" : "Save"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-white/15 bg-black/20 text-xs text-white" onClick={() => saveCanvas("active")} disabled={saving}>
            Publish
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-white/15 bg-black/20 text-xs text-white" onClick={() => setDebugMode((value) => !value)}>
            Debug {debugMode ? "On" : "Off"}
          </Button>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={{ automation: AutomationNode }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={(event) => event.preventDefault()}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          fitView
          minZoom={0.2}
          maxZoom={2}
          panOnScroll
          selectionOnDrag
        >
          <Background color="#23313d" variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls className="!border-white/10 !bg-black/70 !text-white" />
          <MiniMap pannable zoomable nodeStrokeWidth={3} nodeColor={(node) => node.data?.color || "#22c55e"} />
        </ReactFlow>
      </main>

      <aside className="no-scrollbar border-l border-border bg-card overflow-y-auto">
        <div className="sticky top-0 z-10 border-b border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">{selectedFlow?.name || "New visual flow"}</div>
              <div className="text-[11px] text-muted-foreground">v{selectedFlow?.version || 1} - {nodes.length} nodes - {edges.length} connections</div>
            </div>
            <Badge variant="outline" className={statusStyle[selectedFlow?.status || "draft"]}>{selectedFlow?.status || "draft"}</Badge>
          </div>
        </div>

        <div className="space-y-4 p-3">
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <Map size={14} /> Node Inspector
            </h3>
            {selectedNode ? (
              <div className="space-y-2 rounded-md border border-border bg-background p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded" style={{ backgroundColor: `${selectedNode.data.color}22`, color: selectedNode.data.color }}>
                    {iconFor(selectedNode.data.icon)}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-foreground">{selectedNode.data.label}</div>
                    <div className="text-[11px] text-muted-foreground">{selectedNode.id}</div>
                  </div>
                </div>
                {["body", "url", "keyword", "status", "stage", "variable", "code"].map((field) => (
                  <input
                    key={field}
                    value={String(selectedNode.data.config[field] || "")}
                    onChange={(event) => updateSelectedConfig(field, event.target.value)}
                    placeholder={field}
                    className="h-8 w-full rounded border border-border bg-card px-2 text-xs text-foreground"
                  />
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <Play size={14} /> Testing Mode
            </h3>
            <div className="space-y-2 rounded-md border border-border bg-background p-3">
              <input value={testMessage} onChange={(event) => setTestMessage(event.target.value)} className="h-8 w-full rounded border border-border bg-card px-2 text-xs text-foreground" />
              <Button size="sm" className="h-8 w-full bg-primary text-xs text-primary-foreground" onClick={testFlow} disabled={testing}>
                {testing ? "Running test" : "Run test"}
              </Button>
              {testResult ? (
                <div className="rounded border border-border bg-card p-2 text-[11px] text-muted-foreground">
                  {"error" in testResult ? testResult.error : `${testResult.matched ? "Matched" : "Not matched"} - ${testResult.actions.length} actions`}
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <Activity size={14} /> Flow Analytics
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Runs", selectedFlow?.analytics?.runs || selectedFlow?.runs || 0],
                ["Nodes", nodes.length],
                ["Errors", `${selectedFlow?.analytics?.errorRate || 0}%`],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-border bg-background p-2">
                  <div className="text-sm font-semibold text-foreground">{value}</div>
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <ScrollText size={14} /> Execution Logs
            </h3>
            <div className="space-y-1 rounded-md border border-border bg-background p-2">
              {(selectedFlow?.executionLogs?.length ? selectedFlow.executionLogs : [
                { at: new Date().toISOString(), level: "debug", message: "Canvas ready" },
                { at: new Date().toISOString(), level: "info", message: "Waiting for test run" },
              ]).slice(-6).map((log, index) => (
                <div key={`${log.at}-${index}`} className="rounded bg-card px-2 py-1 text-[11px] text-muted-foreground">
                  <span className="text-primary">{log.level}</span> {log.message}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <History size={14} /> Version History
            </h3>
            <div className="space-y-1">
              {(selectedFlow?.versions?.length ? selectedFlow.versions : [{ version: selectedFlow?.version || 1, label: "Current canvas", at: new Date().toISOString() }]).slice(-4).map((version) => (
                <div key={`${version.version}-${version.at}`} className="rounded border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
                  v{version.version} - {version.label}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <Copy size={14} /> Templates
            </h3>
            <div className="space-y-1">
              {templates.map((template) => (
                <button key={template.name} className="w-full rounded border border-border bg-background px-2 py-2 text-left hover:border-primary/40">
                  <div className="text-xs font-medium text-foreground">{template.name}</div>
                  <div className="mt-1 truncate text-[10px] text-muted-foreground">{template.nodes.join(" -> ")}</div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

export function AutomationView() {
  const [flowList, setFlowList] = useState<Flow[]>([]);
  const [summary, setSummary] = useState({ runsToday: 0, automatedMessages: 0, handoffs: 0 });
  const [selectedFlowId, setSelectedFlowId] = useState("");

  async function loadFlows() {
    const response = await getAutomationFlows<{
      data: Flow[];
      total: number;
      summary: { runsToday: number; automatedMessages: number; handoffs: number };
    }>();
    setFlowList(response.data);
    setSummary(response.summary);
    setSelectedFlowId((current) => current || response.data[0]?.id || "");
  }

  useEffect(() => {
    loadFlows().catch(() => undefined);
  }, []);

  const selectedFlow = flowList.find((flow) => flow.id === selectedFlowId);
  const activeCount = flowList.filter((flow) => flow.status === "active").length;

  function upsertFlow(flow: Flow) {
    setFlowList((items) => {
      const exists = items.some((item) => item.id === flow.id);
      return exists ? items.map((item) => (item.id === flow.id ? flow : item)) : [flow, ...items];
    });
    setSelectedFlowId(flow.id);
  }

  async function newFlow() {
    const response = await createAutomationFlow<{ data: Flow }>({
      name: `Visual Flow ${flowList.length + 1}`,
      description: "Visual automation builder flow",
      trigger: "Visual workflow",
      category: "Visual",
      status: "draft",
      sendReply: false,
      nodes: defaultNodes().map(canvasNodeToServer),
      edges: defaultEdges(),
    });
    upsertFlow(response.data);
  }

  async function toggleStatus(flow: Flow) {
    const response = await updateAutomationFlow<{ data: Flow }>(flow.id, { status: flow.status === "active" ? "inactive" : "active" });
    upsertFlow(response.data);
  }

  async function removeFlow(flow: Flow) {
    await deleteAutomationFlow(flow.id).catch(() => undefined);
    setFlowList((items) => items.filter((item) => item.id !== flow.id));
    setSelectedFlowId((current) => (current === flow.id ? "" : current));
  }

  return (
    <ReactFlowProvider>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-3 py-3 shrink-0 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h1 className="text-foreground">Visual Automation Builder</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{activeCount} active flows - {flowList.length} total - GoHighLevel / ManyChat / n8n style canvas</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8 border-border text-xs" onClick={loadFlows}>
              <RefreshCcw size={13} className="mr-1.5" /> Refresh
            </Button>
            <Button size="sm" className="h-8 bg-primary text-xs text-primary-foreground hover:bg-primary/90" onClick={newFlow}>
              <Plus size={13} className="mr-1.5" /> New visual flow
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-b border-border px-3 py-3 shrink-0 sm:grid-cols-3 sm:px-6">
          {[
            { label: "Flow runs today", value: summary.runsToday.toLocaleString() },
            { label: "Messages automated", value: summary.automatedMessages.toLocaleString() },
            { label: "Handoff to agent", value: summary.handoffs.toLocaleString() },
          ].map((item) => (
            <Card key={item.label} className="bg-card p-3 border-border">
              <div className="text-lg font-semibold text-foreground">{item.value}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{item.label}</div>
            </Card>
          ))}
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-72 shrink-0 border-r border-border bg-card/70 lg:block">
            <div className="border-b border-border p-3">
              <div className="text-sm font-semibold text-foreground">Flows</div>
              <div className="text-[11px] text-muted-foreground">Saved workflows</div>
            </div>
            <div className="no-scrollbar h-full overflow-y-auto p-2">
              {flowList.map((flow) => (
                <button
                  key={flow.id}
                  className={`mb-2 w-full rounded-md border p-3 text-left transition ${selectedFlowId === flow.id ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/30"}`}
                  onClick={() => setSelectedFlowId(flow.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{flow.name}</span>
                    <Badge variant="outline" className={`shrink-0 text-[10px] ${statusStyle[flow.status]}`}>{flow.status}</Badge>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">{flow.actionSummary?.join(" -> ") || "Visual workflow"}</div>
                  <div className="mt-2 flex gap-1">
                    <button className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10" onClick={(event) => { event.stopPropagation(); toggleStatus(flow); }}>
                      {flow.status === "active" ? "Pause" : "Activate"}
                    </button>
                    <button className="rounded px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10" onClick={(event) => { event.stopPropagation(); removeFlow(flow); }}>
                      <Trash2 size={10} className="inline" /> Delete
                    </button>
                  </div>
                </button>
              ))}
              {!flowList.length ? (
                <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No flows yet. Create a visual flow.
                </div>
              ) : null}
            </div>
          </aside>

          <BuilderCanvas selectedFlow={selectedFlow} onFlowSaved={upsertFlow} />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
