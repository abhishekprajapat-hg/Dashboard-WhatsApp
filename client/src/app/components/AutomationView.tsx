import { DragEvent, FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Position,
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
  Maximize2,
  MessageCircle,
  Minimize2,
  MousePointer2,
  Network,
  Play,
  Plus,
  RefreshCcw,
  Route,
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
  ZoomIn,
  ZoomOut,
  Lock,
  Unlock,
  Workflow,
  Instagram,
  ShoppingBag,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { isPlanLimitError, PlanLockedState } from "./PlanLockedState";
import {
  createAutomationFlow,
  deleteAutomationFlow,
  getAutomationFlows,
  getAutomationRuns,
  getTemplates,
  getWhatsAppFlows,
  testAutomationFlow,
  updateAutomationCanvas,
  updateAutomationFlow,
} from "../lib/api";

type FlowStatus = "active" | "inactive" | "draft";

interface WhatsAppFlowOption {
  id: string;
  name: string;
  status: "draft" | "published" | "deprecated";
}

interface Flow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  triggerType?: string;
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

interface InternalTemplate {
  id: string;
  name: string;
  body: string;
  type: string;
}

const simpleTriggerOptions = [
  { id: "new_message", label: "New message" },
  { id: "new_lead", label: "New lead" },
  { id: "keyword_match", label: "Keyword match" },
  { id: "stage_changed", label: "Stage changed" },
];

const leadStageOptions = [
  { id: "new_lead", label: "New lead" },
  { id: "contacted", label: "Contacted" },
  { id: "qualified", label: "Qualified" },
  { id: "proposal_sent", label: "Proposal sent" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

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

interface AutomationRunStep {
  nodeId: string;
  type: string;
  status: string;
  at: string;
  branch?: string;
  action?: { type: string; [key: string]: unknown } | null;
  error?: string;
}

interface AutomationRunSummary {
  id: string;
  flowId: string;
  flowName: string | null;
  parentRunId: string | null;
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  testMode: boolean;
  stepCount: number;
  trigger: { body: string; isNewConversation: boolean; isNewLead: boolean; stageChanged: boolean };
  history: AutomationRunStep[];
  error: string;
  resumeAt: string | null;
  createdAt: string;
  updatedAt: string;
  // sub_workflow child runs (any flow), nested by server/routes/automation.js's nestDescendants.
  children: AutomationRunSummary[];
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

const fieldClass =
  "h-9 w-full rounded-md border border-border bg-background/80 px-3 text-xs text-foreground shadow-inner shadow-black/10 outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

const textareaClass =
  "min-h-[84px] w-full rounded-md border border-border bg-background/80 px-3 py-2 text-xs leading-relaxed text-foreground shadow-inner shadow-black/10 outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

const statusLabel: Record<string, string> = {
  active: "Active",
  inactive: "Paused",
  draft: "Draft",
};

const statusDot: Record<string, string> = {
  active: "bg-primary shadow-[0_0_14px_rgba(34,197,94,0.45)]",
  inactive: "bg-muted-foreground",
  draft: "bg-yellow-400 shadow-[0_0_14px_rgba(250,204,21,0.35)]",
};

const runStatusStyle: Record<string, string> = {
  running: "border-blue-500/30 bg-blue-500/15 text-blue-300",
  waiting: "border-yellow-500/30 bg-yellow-500/15 text-yellow-300",
  completed: "border-primary/30 bg-primary/15 text-primary",
  failed: "border-destructive/30 bg-destructive/15 text-destructive",
  cancelled: "border-border bg-secondary text-muted-foreground",
};

const stepStatusColor: Record<string, string> = {
  ok: "text-primary",
  queued: "text-blue-300",
  skipped: "text-muted-foreground",
  failed: "text-destructive",
  waiting: "text-yellow-300",
};

function formatDateTime(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function flowTriggerLabel(flow: Flow) {
  return simpleTriggerOptions.find((item) => item.id === flow.triggerType)?.label || flow.trigger || "New message";
}

function flowKeywordSummary(flow: Flow) {
  const keywords = flow.keywords?.length ? flow.keywords : flow.keyword ? [flow.keyword] : [];
  if (!keywords.length) return flow.triggerType === "keyword_match" ? "Keyword not set" : "All matching events";
  return keywords.slice(0, 3).join(", ");
}

function flowActionSummary(flow: Flow) {
  if (flow.actionSummary?.length) return flow.actionSummary.join(" -> ");
  const nodeLabels = (flow.nodes || [])
    .filter((node) => node.type !== "trigger" && node.type !== "keyword")
    .map((node) => catalogFor(node.type).label);
  if (nodeLabels.length) return nodeLabels.slice(0, 4).join(" -> ");
  return "No actions configured";
}

function flowRunCount(flow: Flow) {
  return flow.analytics?.runs ?? flow.runs ?? 0;
}

function flowLastRun(flow: Flow) {
  return formatDateTime(flow.analytics?.lastRunAt || flow.lastRun);
}

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
  { kind: "send_instagram", label: "Instagram DM", icon: "Instagram", color: "#e1306c", description: "Send an Instagram DM" },
  { kind: "send_message", label: "WhatsApp Send", icon: "MessageCircle", color: "#22c55e", description: "Send WhatsApp message" },
  { kind: "send_flow", label: "Send Flow", icon: "Workflow", color: "#f472b6", description: "Send an in-chat form" },
  { kind: "send_product_message", label: "Send Product", icon: "ShoppingBag", color: "#0ea5e9", description: "Send a catalog product" },
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
  const icons: Record<string, ReactNode> = {
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
    Workflow: <Workflow size={size} />,
    Instagram: <Instagram size={size} />,
    ShoppingBag: <ShoppingBag size={size} />,
    Zap: <Zap size={size} />,
  };
  return icons[name] || <Zap size={size} />;
}

function catalogFor(kind: string) {
  return nodeCatalog.find((node) => node.kind === kind) || nodeCatalog[0];
}

const handleClass = "!h-2.5 !w-2.5 !border-2 !border-background !bg-muted-foreground";

// Node kinds with more than one source handle - condition/if_else route true/false, loop routes
// loop (still iterating, back into the body)/done (exhausted, continue the main flow). Every
// other kind keeps the single unlabeled default handle below.
const branchHandlesByKind: Record<string, { id: string; label: string; dotClassName: string; textClassName: string }[]> = {
  condition: [
    { id: "true", label: "T", dotClassName: "!bg-primary", textClassName: "text-primary" },
    { id: "false", label: "F", dotClassName: "!bg-destructive", textClassName: "text-destructive" },
  ],
  if_else: [
    { id: "true", label: "T", dotClassName: "!bg-primary", textClassName: "text-primary" },
    { id: "false", label: "F", dotClassName: "!bg-destructive", textClassName: "text-destructive" },
  ],
  loop: [
    { id: "loop", label: "↻", dotClassName: "!bg-yellow-500", textClassName: "text-yellow-300" },
    { id: "done", label: "✓", dotClassName: "!bg-primary", textClassName: "text-primary" },
  ],
};

function AutomationNode({ data, selected }: NodeProps<Node<AutomationNodeData>>) {
  const branchHandles = branchHandlesByKind[data.kind];
  return (
    <div className={`relative w-[210px] rounded-md border bg-card shadow-sm transition ${selected ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
      <Handle type="target" position={Position.Left} className={handleClass} />
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
      {branchHandles ? (
        branchHandles.flatMap((handle, index) => [
          <Handle
            key={`${handle.id}-handle`}
            type="source"
            position={Position.Right}
            id={handle.id}
            style={{ top: `${38 + index * 34}%` }}
            className={`!h-2.5 !w-2.5 !border-2 !border-background ${handle.dotClassName}`}
          />,
          <span
            key={`${handle.id}-label`}
            className={`pointer-events-none absolute right-1.5 text-[9px] font-semibold ${handle.textClassName}`}
            style={{ top: `${30 + index * 34}%` }}
          >
            {handle.label}
          </span>,
        ])
      ) : (
        <Handle type="source" position={Position.Right} className={handleClass} />
      )}
    </div>
  );
}

function serverNodeToCanvas(node: ServerNode, index: number): Node<AutomationNodeData> {
  const item = catalogFor(node.type);
  const id = String(node.id || `${node.type || "node"}_${index}`);
  return {
    id,
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

function normalizeCanvasNodes(items: ServerNode[] = []) {
  const seen = new Set<string>();
  return items.map((node, index) => {
    const baseId = String(node.id || `${node.type || "node"}_${index}`);
    const id = seen.has(baseId) ? `${baseId}_${index}` : baseId;
    seen.add(id);
    return serverNodeToCanvas({ ...node, id }, index);
  });
}

function canvasNodeToServer(node: Node<AutomationNodeData>): ServerNode {
  return {
    id: node.id,
    type: node.data.kind,
    position: node.position,
    config: node.data.config || {},
  };
}

function normalizeCanvasEdges(items: Edge[] = []) {
  const seen = new Set<string>();
  return items
    .filter((edge) => edge?.source && edge?.target)
    .map((edge, index) => {
      const baseId = String(edge.id || `${edge.source}-${edge.target}-${index}`);
      const id = seen.has(baseId) ? `${baseId}-${index}` : baseId;
      seen.add(id);
      return { ...edge, id, source: String(edge.source), target: String(edge.target) };
    });
}

function defaultNodes(): Node<AutomationNodeData>[] {
  return [
    serverNodeToCanvas({ id: "trigger", type: "trigger", position: { x: 80, y: 160 }, config: { event: "New conversation" } }, 0),
    serverNodeToCanvas({ id: "send_message_1", type: "send_message", position: { x: 360, y: 160 }, config: { body: "Thanks for reaching out." } }, 1),
  ];
}

function defaultEdges(): Edge[] {
  return normalizeCanvasEdges([{ id: "trigger-send_message_1", source: "trigger", target: "send_message_1", animated: true }]);
}

// Renders one run's card plus its own sub_workflow children recursively underneath it, indented -
// depth is just a render parameter, not separate state, so an arbitrarily deep chain (bounded by
// the server's own MAX_SUB_WORKFLOW_DEPTH cap) nests correctly without extra wiring per level.
function RunHistoryEntry({
  run,
  depth,
  expandedRunIds,
  onToggle,
}: {
  run: AutomationRunSummary;
  depth: number;
  expandedRunIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const expanded = expandedRunIds.has(run.id);

  return (
    <div className={depth > 0 ? "ml-4 border-l border-border/50 pl-2" : ""}>
      <div className="overflow-hidden rounded-md border border-border/70 bg-card/70">
        <button
          type="button"
          onClick={() => onToggle(run.id)}
          className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-secondary/50"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Badge variant="outline" className={runStatusStyle[run.status] || runStatusStyle.completed}>
              {run.status}
            </Badge>
            {run.testMode ? (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">test</span>
            ) : null}
            {depth > 0 ? (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                sub_workflow → {run.flowName || "unknown flow"}
              </span>
            ) : null}
            <span className="truncate text-muted-foreground">{run.trigger.body || "(no trigger body)"}</span>
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{formatDateTime(run.createdAt)}</span>
        </button>
        {expanded ? (
          <div className="space-y-1 border-t border-border/70 bg-background/60 px-2 py-2">
            {run.error ? <p className="text-[11px] text-destructive">{run.error}</p> : null}
            {run.history.length ? (
              run.history.map((step, index) => {
                const item = catalogFor(step.type);
                return (
                  <div key={`${step.nodeId}-${index}`} className="flex items-start gap-2 rounded border border-border/60 bg-card/60 px-2 py-1.5 text-[11px]">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ backgroundColor: `${item.color}22`, color: item.color }}>
                      {iconFor(item.icon, 12)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground">{item.label}</span>
                        <span className={stepStatusColor[step.status] || "text-muted-foreground"}>{step.status}</span>
                        {step.branch ? (
                          <span className="rounded bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground">→ {step.branch}</span>
                        ) : null}
                      </span>
                      {step.error ? <span className="block text-destructive">{step.error}</span> : null}
                      <span className="block text-[10px] text-muted-foreground">{formatDateTime(step.at)}</span>
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="px-1 py-1 text-[11px] text-muted-foreground">No steps recorded for this run.</p>
            )}
          </div>
        ) : null}
      </div>
      {run.children.length ? (
        <div className="mt-1.5 space-y-1.5">
          {run.children.map((child) => (
            <RunHistoryEntry key={child.id} run={child} depth={depth + 1} expandedRunIds={expandedRunIds} onToggle={onToggle} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BuilderCanvas({
  selectedFlow,
  onFlowSaved,
  canWrite = false,
  availableFlows = [],
  availableWhatsAppFlows = [],
}: {
  selectedFlow?: Flow;
  onFlowSaved: (flow: Flow) => void;
  canWrite?: boolean;
  availableFlows?: Flow[];
  availableWhatsAppFlows?: WhatsAppFlowOption[];
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
  const [canvasMaximized, setCanvasMaximized] = useState(false);
  const [canvasLocked, setCanvasLocked] = useState(false);
  const [runs, setRuns] = useState<AutomationRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());

  function toggleRunExpanded(runId: string) {
    setExpandedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  const loadRuns = useCallback((flowId: string) => {
    setRunsLoading(true);
    getAutomationRuns<{ data: AutomationRunSummary[] }>(flowId)
      .then((response) => setRuns(response.data))
      .catch(() => setRuns([]))
      .finally(() => setRunsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedFlow) return;
    setNodes(selectedFlow.nodes?.length ? normalizeCanvasNodes(selectedFlow.nodes) : defaultNodes());
    setEdges(selectedFlow.edges?.length ? normalizeCanvasEdges(selectedFlow.edges) : defaultEdges());
    setSelectedNodeId(selectedFlow.nodes?.[0]?.id || "trigger");
    setTestResult(null);
    setExpandedRunIds(new Set());
    setRuns([]);
    loadRuns(selectedFlow.id);
  }, [selectedFlow?.id, loadRuns]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  useEffect(() => {
    const timer = window.setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 250 }), 80);
    return () => window.clearTimeout(timer);
  }, [canvasMaximized, reactFlow]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<AutomationNodeData>>[]) => setNodes((items) => applyNodeChanges(changes, items)),
    []
  );
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((items) => normalizeCanvasEdges(applyEdgeChanges(changes, items))), []);
  const onConnect = useCallback((connection: Connection) => {
    setEdges((items) => normalizeCanvasEdges(addEdge({ ...connection, id: `${connection.source}-${connection.target}-${Date.now()}`, animated: true }, items)));
  }, []);

  function onDragStart(event: DragEvent, kind: string) {
    if (!canWrite) return;
    event.dataTransfer.setData("application/automation-node", kind);
    event.dataTransfer.effectAllowed = "move";
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    if (!canWrite) return;
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
    if (!canWrite || !selectedNode) return;
    setNodes((items) =>
      items.map((node) =>
        node.id === selectedNode.id
          ? { ...node, data: { ...node.data, config: { ...node.data.config, [key]: value } } }
          : node
      )
    );
  }

  function renderNodeInspectorFields(node: Node<AutomationNodeData>) {
    const cfg = node.data.config || {};

    if (node.data.kind === "delay") {
      return (
        <>
          <label className="block text-[10px] font-medium text-muted-foreground">Duration</label>
          <input
            type="number"
            min={0}
            value={String(cfg.duration ?? "")}
            onChange={(event) => updateSelectedConfig("duration", event.target.value)}
            disabled={!canWrite}
            placeholder="e.g. 5"
            className={fieldClass}
          />
          <label className="block text-[10px] font-medium text-muted-foreground">Unit</label>
          <select
            value={String(cfg.unit || "seconds")}
            onChange={(event) => updateSelectedConfig("unit", event.target.value)}
            disabled={!canWrite}
            className={fieldClass}
          >
            <option value="seconds">Seconds</option>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </>
      );
    }

    if (node.data.kind === "condition" || node.data.kind === "if_else") {
      return (
        <>
          <label className="block text-[10px] font-medium text-muted-foreground">Field path</label>
          <input
            value={String(cfg.field ?? "")}
            onChange={(event) => updateSelectedConfig("field", event.target.value)}
            disabled={!canWrite}
            placeholder="trigger.body"
            className={fieldClass}
          />
          <label className="block text-[10px] font-medium text-muted-foreground">Operator</label>
          <select
            value={String(cfg.operator || "equals")}
            onChange={(event) => updateSelectedConfig("operator", event.target.value)}
            disabled={!canWrite}
            className={fieldClass}
          >
            <option value="equals">Equals</option>
            <option value="not_equals">Not equals</option>
            <option value="contains">Contains</option>
            <option value="not_contains">Does not contain</option>
            <option value="greater_than">Greater than</option>
            <option value="less_than">Less than</option>
            <option value="is_empty">Is empty</option>
            <option value="is_not_empty">Is not empty</option>
          </select>
          <label className="block text-[10px] font-medium text-muted-foreground">Value</label>
          <input
            value={String(cfg.value ?? "")}
            onChange={(event) => updateSelectedConfig("value", event.target.value)}
            disabled={!canWrite}
            placeholder="Comparison value"
            className={fieldClass}
          />
          <p className="text-[10px] text-muted-foreground">True/false branches connect from this node's two right-side handles.</p>
        </>
      );
    }

    if (node.data.kind === "loop") {
      return (
        <>
          <label className="block text-[10px] font-medium text-muted-foreground">Items (field path)</label>
          <input
            value={String(cfg.field ?? "")}
            onChange={(event) => updateSelectedConfig("field", event.target.value)}
            disabled={!canWrite}
            placeholder="steps.apiNode.parsed.items"
            className={fieldClass}
          />
          <p className="text-[10px] text-muted-foreground">
            Wire the "loop" handle to the body of nodes to run per item, ending with an edge back to this node. Wire "done" to
            continue after every item. Inside the body, use {"{{steps."}{node.id}{".item}}"} for the current item.
          </p>
        </>
      );
    }

    if (node.data.kind === "sub_workflow") {
      const callableFlows = availableFlows.filter((flow) => flow.status === "active");
      return (
        <>
          <label className="block text-[10px] font-medium text-muted-foreground">Flow to call</label>
          <select
            value={String(cfg.flowId ?? "")}
            onChange={(event) => updateSelectedConfig("flowId", event.target.value)}
            disabled={!canWrite}
            className={fieldClass}
          >
            <option value="">Select a flow...</option>
            {callableFlows.map((flow) => (
              <option key={flow.id} value={flow.id}>
                {flow.name}
              </option>
            ))}
          </select>
          <label className="block text-[10px] font-medium text-muted-foreground">Input (optional)</label>
          <textarea
            value={String(cfg.body ?? "")}
            onChange={(event) => updateSelectedConfig("body", event.target.value)}
            disabled={!canWrite}
            placeholder="Passed to the called flow as {{variables.input}}"
            className={textareaClass}
          />
          <p className="text-[10px] text-muted-foreground">
            Only active flows can be called. Runs the called flow synchronously and waits for it to finish (unless it hits its
            own delay node).
          </p>
        </>
      );
    }

    if (node.data.kind === "send_flow") {
      const publishedWhatsAppFlows = availableWhatsAppFlows.filter((flow) => flow.status === "published");
      return (
        <>
          <label className="block text-[10px] font-medium text-muted-foreground">Flow to send</label>
          <select
            value={String(cfg.flowId ?? "")}
            onChange={(event) => updateSelectedConfig("flowId", event.target.value)}
            disabled={!canWrite}
            className={fieldClass}
          >
            <option value="">Select a flow...</option>
            {publishedWhatsAppFlows.map((flow) => (
              <option key={flow.id} value={flow.id}>
                {flow.name}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">
            Only published WhatsApp Flows can be sent (Settings &gt; Flows). Sent to the current contact&apos;s phone number -
            skipped if the contact has none.
          </p>
        </>
      );
    }

    if (node.data.kind === "send_product_message") {
      return (
        <>
          <label className="block text-[10px] font-medium text-muted-foreground">Product retailer ID (SKU)</label>
          <input
            value={String(cfg.productRetailerId ?? "")}
            onChange={(event) => updateSelectedConfig("productRetailerId", event.target.value)}
            disabled={!canWrite}
            placeholder="e.g. SKU-001"
            className={fieldClass}
          />
          <label className="block text-[10px] font-medium text-muted-foreground">Message text (optional)</label>
          <input
            value={String(cfg.bodyText ?? "")}
            onChange={(event) => updateSelectedConfig("bodyText", event.target.value)}
            disabled={!canWrite}
            placeholder="Accompanying text, supports {{variables}}"
            className={fieldClass}
          />
          <p className="text-[10px] text-muted-foreground">
            Sent from the triggering WhatsApp account&apos;s connected catalog (Settings &gt; WhatsApp &gt; Catalog ID) to
            the current contact&apos;s phone number - skipped if either is missing.
          </p>
        </>
      );
    }

    if (node.data.kind === "api" || node.data.kind === "http_request") {
      return (
        <>
          <label className="block text-[10px] font-medium text-muted-foreground">Method</label>
          <select
            value={String(cfg.method || "GET")}
            onChange={(event) => updateSelectedConfig("method", event.target.value)}
            disabled={!canWrite}
            className={fieldClass}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
          <label className="block text-[10px] font-medium text-muted-foreground">URL</label>
          <input
            value={String(cfg.url ?? "")}
            onChange={(event) => updateSelectedConfig("url", event.target.value)}
            disabled={!canWrite}
            placeholder="https://api.example.com/..."
            className={fieldClass}
          />
          <label className="block text-[10px] font-medium text-muted-foreground">Headers (JSON)</label>
          <textarea
            value={String(cfg.headers ?? "")}
            onChange={(event) => updateSelectedConfig("headers", event.target.value)}
            disabled={!canWrite}
            placeholder='{"Authorization": "Bearer ..."}'
            className={textareaClass}
          />
          <label className="block text-[10px] font-medium text-muted-foreground">Body (JSON)</label>
          <textarea
            value={String(cfg.body ?? "")}
            onChange={(event) => updateSelectedConfig("body", event.target.value)}
            disabled={!canWrite}
            placeholder='{"key": "value"}'
            className={textareaClass}
          />
        </>
      );
    }

    if (node.data.kind === "email") {
      return (
        <>
          <label className="block text-[10px] font-medium text-muted-foreground">Subject</label>
          <input
            value={String(cfg.subject ?? "")}
            onChange={(event) => updateSelectedConfig("subject", event.target.value)}
            disabled={!canWrite}
            placeholder="Following up on your message"
            className={fieldClass}
          />
          <label className="block text-[10px] font-medium text-muted-foreground">Body</label>
          <textarea
            value={String(cfg.body ?? "")}
            onChange={(event) => updateSelectedConfig("body", event.target.value)}
            disabled={!canWrite}
            placeholder="Hi {{trigger.contactName}}, ..."
            className={textareaClass}
          />
          <p className="text-[10px] text-muted-foreground">Sends to the contact's email address. Requires Email to be enabled under Settings &gt; Integrations.</p>
        </>
      );
    }

    if (node.data.kind === "code_block") {
      return (
        <>
          <label className="block text-[10px] font-medium text-muted-foreground">Code (JavaScript)</label>
          <textarea
            value={String(cfg.code ?? "")}
            onChange={(event) => updateSelectedConfig("code", event.target.value)}
            disabled={!canWrite}
            placeholder={"return context.trigger.body?.toUpperCase();"}
            rows={10}
            spellCheck={false}
            className={`${textareaClass} font-mono`}
          />
          <p className="text-[10px] text-muted-foreground">
            Runs in an isolated sandbox with no network/file access. Read run data via{" "}
            <code>context.trigger</code>, <code>context.steps</code>, <code>context.variables</code> (not{" "}
            {"{{...}}"} tokens). End with <code>return</code> to make the value available downstream as{" "}
            {"{{steps."}
            {node.id}
            {".result}}"}.
          </p>
        </>
      );
    }

    if (node.data.kind === "task" || node.data.kind === "calendar") {
      const isCalendar = node.data.kind === "calendar";
      return (
        <>
          <label className="block text-[10px] font-medium text-muted-foreground">Title</label>
          <input
            value={String(cfg.title ?? "")}
            onChange={(event) => updateSelectedConfig("title", event.target.value)}
            disabled={!canWrite}
            placeholder={isCalendar ? "Follow-up call" : "Send pricing follow-up"}
            className={fieldClass}
          />
          <label className="block text-[10px] font-medium text-muted-foreground">Description</label>
          <textarea
            value={String(cfg.body ?? "")}
            onChange={(event) => updateSelectedConfig("body", event.target.value)}
            disabled={!canWrite}
            placeholder="Notes for whoever picks this up"
            className={textareaClass}
          />
          <label className="block text-[10px] font-medium text-muted-foreground">
            {isCalendar ? "Starts in" : "Due in"}
          </label>
          <input
            type="number"
            min={0}
            value={String(cfg.duration ?? "")}
            onChange={(event) => updateSelectedConfig("duration", event.target.value)}
            disabled={!canWrite}
            placeholder="e.g. 2"
            className={fieldClass}
          />
          <select
            value={String(cfg.unit || (isCalendar ? "hours" : "days"))}
            onChange={(event) => updateSelectedConfig("unit", event.target.value)}
            disabled={!canWrite}
            className={fieldClass}
          >
            <option value="seconds">Seconds</option>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
          {isCalendar && (
            <>
              <label className="block text-[10px] font-medium text-muted-foreground">Length (minutes)</label>
              <input
                type="number"
                min={0}
                value={String(cfg.lengthMinutes ?? "")}
                onChange={(event) => updateSelectedConfig("lengthMinutes", event.target.value)}
                disabled={!canWrite}
                placeholder="30"
                className={fieldClass}
              />
            </>
          )}
          <label className="block text-[10px] font-medium text-muted-foreground">Assigned to (user ID, optional)</label>
          <input
            value={String(cfg.userId ?? "")}
            onChange={(event) => updateSelectedConfig("userId", event.target.value)}
            disabled={!canWrite}
            placeholder="Leave blank to leave unassigned"
            className={fieldClass}
          />
          <p className="text-[10px] text-muted-foreground">
            {isCalendar ? "Starts" : "Due"} relative to when this step runs, computed at execution time - not a
            fixed date. Linked automatically to the triggering contact/conversation when available.
          </p>
        </>
      );
    }

    return ["body", "url", "keyword", "status", "stage", "variable", "code"].map((field) => (
      <input
        key={field}
        value={String(cfg[field] || "")}
        onChange={(event) => updateSelectedConfig(field, event.target.value)}
        disabled={!canWrite}
        placeholder={field}
        className={fieldClass}
      />
    ));
  }

  async function saveCanvas(status?: FlowStatus) {
    if (!canWrite) return;
    setSaving(true);
    try {
      const payload = {
        name: selectedFlow?.name || "Visual Automation Flow",
        status: status || selectedFlow?.status || "draft",
        triggerType: selectedFlow?.triggerType || "new_message",
        trigger: selectedFlow?.trigger || "New message",
        description: selectedFlow?.description || "Visual automation builder flow",
        category: selectedFlow?.category || "Visual",
        keyword: selectedFlow?.keyword || "",
        nodes: nodes.map(canvasNodeToServer),
        edges: normalizeCanvasEdges(edges),
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
    if (!canWrite) return;
    if (!selectedFlow) {
      await saveCanvas("active");
      return;
    }
    setTesting(true);
    try {
      const response = await testAutomationFlow<TestResult>(selectedFlow.id, testMessage);
      setTestResult(response);
      if (response.flow) onFlowSaved(response.flow);
      loadRuns(selectedFlow.id);
    } catch (error) {
      setTestResult({ error: error instanceof Error ? error.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  const controlButtonClass =
    "flex h-9 w-9 items-center justify-center border-b border-white/10 text-white transition last:border-b-0 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <div
      className={
        canvasMaximized
          ? "fixed inset-0 z-50 grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden bg-background"
          : "grid h-[min(58vh,560px)] min-h-[360px] w-full grid-cols-[minmax(0,1fr)] overflow-hidden lg:h-[min(62vh,600px)] lg:min-h-[500px] lg:grid-cols-[240px_minmax(0,1fr)_310px]"
      }
    >
      {!canvasMaximized ? (
      <aside className="no-scrollbar hidden overflow-y-auto border-r border-border bg-card/60 p-3 lg:block">
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
              draggable={canWrite}
              onDragStart={(event) => onDragStart(event, item.kind)}
              className={`flex w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-2 text-left transition ${canWrite ? "hover:border-primary/40 hover:bg-secondary" : "cursor-not-allowed opacity-60"}`}
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
      ) : null}

      <main className="relative min-h-0 min-w-0 bg-[#0b0f14]">
        <div className="absolute left-2 right-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-2 rounded-md border border-white/10 bg-black/50 p-2 backdrop-blur sm:left-3 sm:right-auto sm:top-3">
          {canWrite && <Button size="sm" className="h-8 bg-primary text-xs text-primary-foreground" onClick={() => saveCanvas()} disabled={saving}>
            <Save size={13} className="mr-1" /> {saving ? "Saving" : "Save"}
          </Button>}
          {canWrite && <Button size="sm" variant="outline" className="h-8 border-white/15 bg-black/20 text-xs text-white" onClick={() => saveCanvas("active")} disabled={saving}>
            Publish
          </Button>}
          <Button size="sm" variant="outline" className="h-8 border-white/15 bg-black/20 text-xs text-white" onClick={() => setDebugMode((value) => !value)}>
            Debug {debugMode ? "On" : "Off"}
          </Button>
        </div>
        <div className="absolute bottom-3 left-2 z-10 overflow-hidden rounded-md border border-white/15 bg-[#111820]/95 shadow-xl backdrop-blur sm:left-3">
          <button type="button" className={controlButtonClass} title="Zoom in" aria-label="Zoom in" onClick={() => reactFlow.zoomIn({ duration: 180 })}>
            <ZoomIn size={16} strokeWidth={2.4} />
          </button>
          <button type="button" className={controlButtonClass} title="Zoom out" aria-label="Zoom out" onClick={() => reactFlow.zoomOut({ duration: 180 })}>
            <ZoomOut size={16} strokeWidth={2.4} />
          </button>
          <button type="button" className={controlButtonClass} title="Fit canvas" aria-label="Fit canvas" onClick={() => reactFlow.fitView({ padding: 0.2, duration: 220 })}>
            <Map size={16} strokeWidth={2.4} />
          </button>
          <button type="button" className={controlButtonClass} title={canvasLocked ? "Unlock canvas" : "Lock canvas"} aria-label={canvasLocked ? "Unlock canvas" : "Lock canvas"} onClick={() => setCanvasLocked((value) => !value)}>
            {canvasLocked ? <Lock size={16} strokeWidth={2.4} /> : <Unlock size={16} strokeWidth={2.4} />}
          </button>
          <button type="button" className={controlButtonClass} title={canvasMaximized ? "Exit maximize" : "Maximize canvas"} aria-label={canvasMaximized ? "Exit maximize" : "Maximize canvas"} onClick={() => setCanvasMaximized((value) => !value)}>
            {canvasMaximized ? <Minimize2 size={16} strokeWidth={2.4} /> : <Maximize2 size={16} strokeWidth={2.4} />}
          </button>
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
          selectionOnDrag={!canvasLocked && canWrite}
          panOnDrag={!canvasLocked}
          nodesDraggable={!canvasLocked && canWrite}
          nodesConnectable={!canvasLocked && canWrite}
          elementsSelectable={!canvasLocked}
        >
          <Background color="#23313d" variant={BackgroundVariant.Dots} gap={18} size={1} />
          <MiniMap pannable zoomable nodeStrokeWidth={3} nodeColor={(node: Node<AutomationNodeData>) => node.data.color || "#22c55e"} />
        </ReactFlow>
      </main>

      {!canvasMaximized ? (
      <aside className="no-scrollbar hidden overflow-y-auto border-l border-border bg-card lg:block">
        <div className="sticky top-0 z-10 border-b border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">{selectedFlow?.name || "New visual flow"}</div>
              <div className="text-[11px] text-muted-foreground">v{selectedFlow?.version || 1} - {nodes.length} nodes - {edges.length} connections</div>
            </div>
            <Badge variant="outline" className={statusStyle[selectedFlow?.status || "draft"]}>{selectedFlow?.status || "draft"}</Badge>
          </div>
        </div>

        <div className="space-y-3 p-3">
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
                {renderNodeInspectorFields(selectedNode)}
              </div>
            ) : null}
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <Play size={14} /> Testing Mode
            </h3>
            <div className="space-y-2 rounded-md border border-border bg-background p-3">
              <input
                value={testMessage}
                onChange={(event) => setTestMessage(event.target.value)}
                className={fieldClass}
                placeholder="Incoming test message"
              />
              <Button size="sm" className="h-8 w-full bg-primary text-xs text-primary-foreground" onClick={testFlow} disabled={testing || !canWrite}>
                {testing ? "Running test" : "Run test"}
              </Button>
              {testResult ? (
                <div
                  className={`space-y-2 rounded-md border p-3 text-[11px] ${
                    "error" in testResult
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : testResult.matched
                        ? "border-primary/30 bg-primary/10 text-foreground"
                        : "border-yellow-500/30 bg-yellow-500/10 text-foreground"
                  }`}
                >
                  {"error" in testResult ? (
                    <div className="font-medium">{testResult.error}</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{testResult.matched ? "Matched automation" : "No match"}</span>
                        <Badge variant="outline" className={testResult.matched ? "border-primary/30 bg-primary/15 text-primary" : "border-yellow-500/30 bg-yellow-500/15 text-yellow-300"}>
                          {testResult.actions.length} actions
                        </Badge>
                      </div>
                      {testResult.message ? <p className="text-muted-foreground">{testResult.message}</p> : null}
                      <div className="space-y-1">
                        {testResult.actions.length ? (
                          testResult.actions.slice(0, 4).map((action, index) => (
                            <div key={`${action.type}-${index}`} className="rounded border border-border/70 bg-card/70 px-2 py-1 text-muted-foreground">
                              <span className="font-medium text-foreground">{action.type.replace(/_/g, " ")}</span>
                              {action.status ? ` - ${action.status}` : ""}
                              {action.tag ? ` - ${action.tag}` : ""}
                              {action.error ? <span className="text-destructive"> - {action.error}</span> : null}
                            </div>
                          ))
                        ) : (
                          <div className="rounded border border-dashed border-border px-2 py-1 text-muted-foreground">No actions executed.</div>
                        )}
                      </div>
                    </>
                  )}
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
              <Route size={14} /> Run History
            </h3>
            <div className="space-y-1.5 rounded-md border border-border bg-background p-2">
              {runsLoading ? (
                <div className="rounded border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                  Loading runs...
                </div>
              ) : runs.length ? (
                runs.slice(0, 20).map((run) => (
                  <RunHistoryEntry key={run.id} run={run} depth={0} expandedRunIds={expandedRunIds} onToggle={toggleRunExpanded} />
                ))
              ) : (
                <div className="rounded border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                  No runs yet. Run a test or wait for an inbound match.
                </div>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <ScrollText size={14} /> Execution Logs
            </h3>
            <div className="space-y-1 rounded-md border border-border bg-background p-2">
              {selectedFlow?.executionLogs?.length ? (
                selectedFlow.executionLogs.slice(-6).map((log, index) => (
                  <div key={`${log.at}-${index}`} className="rounded-md border border-border/70 bg-card/70 px-2 py-1.5 text-[11px] text-muted-foreground">
                    <div className="flex items-center justify-between gap-2">
                      <span className={log.level === "error" ? "font-medium text-destructive" : "font-medium text-primary"}>{log.level}</span>
                      <span>{formatDateTime(log.at)}</span>
                    </div>
                    <div className="mt-0.5 text-foreground/90">{log.message}</div>
                    {log.nodeId ? <div className="mt-0.5 text-[10px] text-muted-foreground">Node: {log.nodeId}</div> : null}
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                  No automation logs yet. Run a test or wait for an inbound match.
                </div>
              )}
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
      ) : null}
    </div>
  );
}

interface AutomationViewProps {
  canWrite?: boolean;
}

export function AutomationView({ canWrite = false }: AutomationViewProps) {
  const [flowList, setFlowList] = useState<Flow[]>([]);
  const [whatsAppFlowsList, setWhatsAppFlowsList] = useState<WhatsAppFlowOption[]>([]);
  const [summary, setSummary] = useState({ runsToday: 0, automatedMessages: 0, handoffs: 0 });
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [simpleForm, setSimpleForm] = useState({
    name: "Keyword auto-reply",
    triggerType: "keyword_match",
    keyword: "price",
    actionMessage: "Thanks for your message. Our team will share details shortly.",
    templateId: "",
    tagName: "Lead",
    leadStage: "new_lead",
    nextStatus: "open",
    sendToGoogleSheet: false,
    status: "active" as FlowStatus,
  });
  const [editingSimpleId, setEditingSimpleId] = useState("");
  const [creatingSimple, setCreatingSimple] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState<InternalTemplate[]>([]);
  const [loadingFlows, setLoadingFlows] = useState(true);
  const [testingFlowId, setTestingFlowId] = useState("");
  const [quickTestResults, setQuickTestResults] = useState<Record<string, TestResult | { error: string }>>({});
  const [lockedMessage, setLockedMessage] = useState("");

  async function loadFlows() {
    setLoadingFlows(true);
    try {
      const response = await getAutomationFlows<{
        data: Flow[];
        total: number;
        summary: { runsToday: number; automatedMessages: number; handoffs: number };
      }>();
      setFlowList(response.data);
      setSummary(response.summary);
      setSelectedFlowId((current) => current || response.data[0]?.id || "");
      setLockedMessage("");
    } catch (error) {
      if (isPlanLimitError(error)) setLockedMessage(error.message);
      else throw error;
    } finally {
      setLoadingFlows(false);
    }
  }

  useEffect(() => {
    loadFlows().catch(() => undefined);
    getTemplates<{ data: InternalTemplate[] }>({ status: "active" })
      .then((response) => setMessageTemplates(response.data.filter((template) => ["quick_reply", "automation", "follow_up", "lead_stage"].includes(template.type))))
      .catch(() => undefined);
    getWhatsAppFlows<{ data: WhatsAppFlowOption[] }>()
      .then((response) => setWhatsAppFlowsList(response.data))
      .catch(() => undefined);
  }, []);

  const selectedFlow = flowList.find((flow) => flow.id === selectedFlowId);
  const activeCount = flowList.filter((flow) => flow.status === "active").length;
  const pausedCount = flowList.filter((flow) => flow.status === "inactive").length;
  const draftCount = flowList.filter((flow) => flow.status === "draft").length;

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
      triggerType: "new_message",
      category: "Visual",
      status: "draft",
      sendReply: false,
      nodes: defaultNodes().map(canvasNodeToServer),
      edges: defaultEdges(),
    });
    upsertFlow(response.data);
  }

  async function createSimpleFlow(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) return;
    setCreatingSimple(true);
    try {
      const payload = {
        name: simpleForm.name,
        description: "Simple WhatsApp automation",
        trigger: simpleTriggerOptions.find((item) => item.id === simpleForm.triggerType)?.label || "New message",
        triggerType: simpleForm.triggerType,
        category: "WhatsApp",
        status: simpleForm.status,
        keyword: simpleForm.keyword,
        actionMessage: simpleForm.actionMessage,
        templateId: simpleForm.templateId || undefined,
        sendReply: Boolean(simpleForm.actionMessage.trim() || simpleForm.templateId),
        tagName: simpleForm.tagName,
        nextStatus: simpleForm.nextStatus,
        addToCrm: simpleForm.triggerType === "new_lead" || Boolean(simpleForm.leadStage),
        leadStage: simpleForm.leadStage,
        sendToGoogleSheet: simpleForm.sendToGoogleSheet,
        simpleEdit: Boolean(editingSimpleId),
      };
      const response = editingSimpleId
        ? await updateAutomationFlow<{ data: Flow }>(editingSimpleId, payload)
        : await createAutomationFlow<{ data: Flow }>(payload);
      upsertFlow(response.data);
      setEditingSimpleId("");
    } finally {
      setCreatingSimple(false);
    }
  }

  function editSimpleFlow(flow: Flow) {
    const sendNode = (flow.nodes || []).find((node) => node.type === "send_message");
    const tagNode = (flow.nodes || []).find((node) => node.type === "add_tag");
    const statusNode = (flow.nodes || []).find((node) => node.type === "set_status");
    const leadNode = (flow.nodes || []).find((node) => node.type === "add_to_crm" || node.type === "lead_stage" || node.type === "google_sheets");
    const hasSheets = (flow.nodes || []).some((node) => node.type === "google_sheets");

    setEditingSimpleId(flow.id);
    setSimpleForm({
      name: flow.name,
      triggerType: flow.triggerType || "new_message",
      keyword: flow.keyword || "",
      actionMessage: String(sendNode?.config?.body || ""),
      templateId: String(sendNode?.config?.templateId || ""),
      tagName: String(tagNode?.config?.name || ""),
      leadStage: String(leadNode?.config?.stage || "new_lead"),
      nextStatus: String(statusNode?.config?.status || "open"),
      sendToGoogleSheet: hasSheets,
      status: flow.status,
    });
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

  async function quickTestFlow(flow: Flow, event: { stopPropagation: () => void }) {
    event.stopPropagation();
    if (!canWrite) return;
    setTestingFlowId(flow.id);
    try {
      const response = await testAutomationFlow<TestResult>(flow.id, flow.keyword || simpleForm.keyword || "test");
      setQuickTestResults((current) => ({ ...current, [flow.id]: response }));
      if (response.flow) upsertFlow(response.flow);
    } catch (error) {
      setQuickTestResults((current) => ({
        ...current,
        [flow.id]: { error: error instanceof Error ? error.message : "Test failed" },
      }));
    } finally {
      setTestingFlowId("");
    }
  }

  if (lockedMessage) {
    return (
      <div className="flex min-h-full w-full items-center justify-center p-6">
        <PlanLockedState title="Automation builder is locked" message={lockedMessage} />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="flex min-h-full w-full min-w-0 flex-col overflow-x-hidden overflow-y-visible">
        <div className="shrink-0 border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.74),rgba(2,6,23,0.18))] px-3 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Automation</Badge>
              <span className="text-[11px] text-muted-foreground">{activeCount} active - {pausedCount} paused - {draftCount} draft</span>
            </div>
            <h1 className="text-foreground">Visual Automation Builder</h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">Build WhatsApp triggers, CRM actions, templates, and handoff flows while keeping every execution path visible.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8 border-border bg-card/60 text-xs" onClick={loadFlows} disabled={loadingFlows}>
              <RefreshCcw size={13} className="mr-1.5" /> {loadingFlows ? "Refreshing" : "Refresh"}
            </Button>
            {canWrite && <Button size="sm" className="h-8 bg-primary text-xs text-primary-foreground hover:bg-primary/90" onClick={newFlow}>
              <Plus size={13} className="mr-1.5" /> New visual flow
            </Button>}
          </div>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-1 gap-3 border-b border-border bg-background/35 px-3 py-3 sm:grid-cols-3 sm:px-6">
          {[
            { label: "Flow runs today", value: summary.runsToday.toLocaleString(), icon: <Zap size={15} />, accent: "from-primary/20 to-emerald-400/5" },
            { label: "Messages automated", value: summary.automatedMessages.toLocaleString(), icon: <MessageCircle size={15} />, accent: "from-blue-500/15 to-cyan-400/5" },
            { label: "Handoff to agent", value: summary.handoffs.toLocaleString(), icon: <UserRoundPlus size={15} />, accent: "from-violet-500/15 to-fuchsia-400/5" },
          ].map((item) => (
            <Card key={item.label} className={`overflow-hidden border-border bg-gradient-to-br ${item.accent} p-3`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-foreground">{item.value}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{item.label}</div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-card/70 text-primary">{item.icon}</div>
              </div>
            </Card>
          ))}
        </div>

        {canWrite && (
          <form onSubmit={createSimpleFlow} className="border-b border-border bg-card/35 px-3 py-4 sm:px-6">
            <Card className="overflow-hidden border-border bg-card/80 shadow-xl shadow-black/10">
              <div className="flex flex-col gap-3 border-b border-border bg-background/45 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                      <Zap size={15} />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">{editingSimpleId ? "Edit WhatsApp automation" : "Simple WhatsApp automation"}</h2>
                      <p className="text-[11px] text-muted-foreground">{editingSimpleId ? "Update the selected flow without opening the visual canvas." : "Create a safe first flow without configuring the visual canvas."}</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {editingSimpleId && (
                    <Button type="button" size="sm" variant="outline" className="h-8 border-border bg-card/60 text-xs" onClick={() => setEditingSimpleId("")}>
                      Cancel edit
                    </Button>
                  )}
                  <Button type="submit" size="sm" className="h-8 bg-primary text-xs text-primary-foreground" disabled={creatingSimple}>
                    <Save size={13} className="mr-1.5" /> {creatingSimple ? "Saving" : editingSimpleId ? "Save changes" : "Create automation"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-3">
                <section className="space-y-3 bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary"><Zap size={14} /></span>
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Trigger</h3>
                      <p className="text-[11px] text-muted-foreground">Choose when the flow starts.</p>
                    </div>
                  </div>
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Flow name</span>
                    <input value={simpleForm.name} onChange={(event) => setSimpleForm((current) => ({ ...current, name: event.target.value }))} className={fieldClass} required />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">Trigger type</span>
                      <select value={simpleForm.triggerType} onChange={(event) => setSimpleForm((current) => ({ ...current, triggerType: event.target.value }))} className={fieldClass}>
                        {simpleTriggerOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">Keyword summary</span>
                      <input value={simpleForm.keyword} onChange={(event) => setSimpleForm((current) => ({ ...current, keyword: event.target.value }))} className={fieldClass} placeholder="price, demo" />
                    </label>
                  </div>
                </section>

                <section className="space-y-3 bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-300"><GitBranch size={14} /></span>
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Conditions</h3>
                      <p className="text-[11px] text-muted-foreground">Set CRM stage and flow state.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">Lead stage</span>
                      <select value={simpleForm.leadStage} onChange={(event) => setSimpleForm((current) => ({ ...current, leadStage: event.target.value }))} className={fieldClass}>
                        {leadStageOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">Automation status</span>
                      <select value={simpleForm.status} onChange={(event) => setSimpleForm((current) => ({ ...current, status: event.target.value as FlowStatus }))} className={fieldClass}>
                        <option value="active">Active</option>
                        <option value="inactive">Paused</option>
                        <option value="draft">Draft</option>
                      </select>
                    </label>
                  </div>
                  <div className="rounded-md border border-border bg-background/60 p-3 text-[11px] text-muted-foreground">
                    <div className="mb-1 font-medium text-foreground">Current rule</div>
                    {simpleForm.triggerType === "keyword_match" ? `Match incoming messages containing "${simpleForm.keyword || "keyword"}".` : `Run when ${simpleTriggerOptions.find((item) => item.id === simpleForm.triggerType)?.label.toLowerCase() || "the event"} happens.`}
                  </div>
                </section>

                <section className="space-y-3 bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/10 text-violet-300"><Send size={14} /></span>
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Actions</h3>
                      <p className="text-[11px] text-muted-foreground">Reply, tag, update status, and sync.</p>
                    </div>
                  </div>
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Template selector</span>
                    <select
                      value={simpleForm.templateId}
                      onChange={(event) => {
                        const template = messageTemplates.find((item) => item.id === event.target.value);
                        setSimpleForm((current) => ({ ...current, templateId: event.target.value, actionMessage: template?.body || current.actionMessage }));
                      }}
                      className={fieldClass}
                    >
                      <option value="">No template</option>
                      {messageTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">WhatsApp reply</span>
                    <textarea value={simpleForm.actionMessage} onChange={(event) => setSimpleForm((current) => ({ ...current, actionMessage: event.target.value }))} className={textareaClass} />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">Tag</span>
                      <input value={simpleForm.tagName} onChange={(event) => setSimpleForm((current) => ({ ...current, tagName: event.target.value }))} className={fieldClass} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">Conversation</span>
                      <select value={simpleForm.nextStatus} onChange={(event) => setSimpleForm((current) => ({ ...current, nextStatus: event.target.value }))} className={fieldClass}>
                        <option value="open">Open</option>
                        <option value="waiting">Waiting</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </label>
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                    <span>Send to Google Sheet</span>
                    <input type="checkbox" checked={simpleForm.sendToGoogleSheet} onChange={(event) => setSimpleForm((current) => ({ ...current, sendToGoogleSheet: event.target.checked }))} className="h-4 w-4 accent-primary" />
                  </label>
                </section>
              </div>
            </Card>
          </form>
        )}

        <div className="flex min-h-[360px] w-full min-w-0 shrink-0 flex-col lg:min-h-[500px] lg:flex-row">
          <aside className="max-h-72 w-full shrink-0 overflow-hidden border-b border-border bg-card/70 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
            <div className="border-b border-border bg-background/35 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-foreground">Flows</div>
                  <div className="text-[11px] text-muted-foreground">Saved workflows and quick tests</div>
                </div>
                <Badge variant="outline" className="border-border bg-card text-[10px] text-muted-foreground">{flowList.length}</Badge>
              </div>
            </div>
            <div className="no-scrollbar max-h-[220px] overflow-y-auto p-2 lg:h-full lg:max-h-none">
              {loadingFlows ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="rounded-md border border-border bg-background p-3">
                      <div className="h-4 w-2/3 animate-pulse rounded bg-secondary" />
                      <div className="mt-3 h-3 w-full animate-pulse rounded bg-secondary" />
                      <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-secondary" />
                    </div>
                  ))}
                </div>
              ) : flowList.length ? (
                flowList.map((flow) => {
                  const result = quickTestResults[flow.id];
                  return (
                    <button
                      key={flow.id}
                      className={`mb-2 w-full rounded-md border p-3 text-left transition ${selectedFlowId === flow.id ? "border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(34,197,94,0.12)]" : "border-border bg-background hover:border-primary/30 hover:bg-card"}`}
                      onClick={() => setSelectedFlowId(flow.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot[flow.status] || statusDot.draft}`} />
                            <span className="truncate text-sm font-medium text-foreground">{flow.name}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <Badge variant="outline" className={`shrink-0 text-[10px] ${statusStyle[flow.status]}`}>{statusLabel[flow.status] || flow.status}</Badge>
                            <Badge variant="outline" className="border-border bg-card/70 text-[10px] text-muted-foreground">{flowTriggerLabel(flow)}</Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-foreground">{flowRunCount(flow).toLocaleString()}</div>
                          <div className="text-[10px] text-muted-foreground">runs</div>
                        </div>
                      </div>

                      <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Tag size={12} className="text-primary" />
                          <span className="truncate">Keywords: {flowKeywordSummary(flow)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Send size={12} className="text-blue-300" />
                          <span className="truncate">Actions: {flowActionSummary(flow)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5 truncate">
                            <History size={12} className="text-violet-300" />
                            Last run: {flowLastRun(flow)}
                          </span>
                          {canWrite ? (
                            <span
                              role="button"
                              tabIndex={0}
                              className="rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary transition hover:bg-primary/15"
                              onClick={(event) => quickTestFlow(flow, event)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") quickTestFlow(flow, event);
                              }}
                            >
                              {testingFlowId === flow.id ? "Testing" : "Test"}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {result ? (
                        <div className={`mt-3 rounded-md border px-2 py-1.5 text-[11px] ${"error" in result ? "border-destructive/30 bg-destructive/10 text-destructive" : result.matched ? "border-primary/30 bg-primary/10 text-primary" : "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"}`}>
                          {"error" in result ? result.error : `${result.matched ? "Matched" : "No match"} - ${result.actions.length} actions executed`}
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-1">
                        {canWrite && <span role="button" tabIndex={0} className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10" onClick={(event) => { event.stopPropagation(); editSimpleFlow(flow); }}>
                          Edit
                        </span>}
                        {canWrite && <span role="button" tabIndex={0} className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10" onClick={(event) => { event.stopPropagation(); toggleStatus(flow); }}>
                          {flow.status === "active" ? "Pause" : "Activate"}
                        </span>}
                        {canWrite && <span role="button" tabIndex={0} className="rounded px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10" onClick={(event) => { event.stopPropagation(); removeFlow(flow); }}>
                          <Trash2 size={10} className="inline" /> Delete
                        </span>}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-md border border-dashed border-border bg-background/60 p-5 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                    <Zap size={17} />
                  </div>
                  <div className="mt-3 text-sm font-medium text-foreground">No automations yet</div>
                  <p className="mt-1 text-xs text-muted-foreground">Create a visual flow or a simple WhatsApp rule to start automating replies.</p>
                </div>
              )}
            </div>
          </aside>

          <BuilderCanvas selectedFlow={selectedFlow} onFlowSaved={upsertFlow} canWrite={canWrite} availableFlows={flowList} availableWhatsAppFlows={whatsAppFlowsList} />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
