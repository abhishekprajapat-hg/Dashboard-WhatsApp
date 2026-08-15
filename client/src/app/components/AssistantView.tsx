import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AudioLines,
  Bot,
  BrainCircuit,
  FileUp,
  Lightbulb,
  Loader2,
  MessageSquareText,
  PackageCheck,
  Play,
  Search,
  Send,
  Sparkles,
  Tags,
  Workflow,
} from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  analyzeAssistantConversation,
  getAssistantOverview,
  runAssistantTool,
  searchAssistant,
  transcribeAssistantVoice,
  uploadKnowledgeDocument,
} from "../lib/api";
import { isPlanLimitError, PlanLockedState } from "./PlanLockedState";

interface AssistantOverview {
  providers: Record<string, boolean>;
  capabilities: string[];
  metrics: Record<string, number>;
  recent: {
    id: string;
    customer: string;
    phone: string;
    summary: string;
    intent: string;
    sentiment: string;
    score: number;
  }[];
}

interface AssistantResult {
  provider: string;
  summary: string;
  autoReply: string;
  draftReplies: string[];
  intent: { label: string; confidence: number };
  sentiment: { label: string; score: number };
  leadQualification: { score: number; stage: string; reasons: string[] };
  productRecommendation: string;
  faqAnswer: string;
  crmInsights: { nextBestAction?: string; followUp?: string; customer?: Record<string, unknown> };
  toolCalls: { name: string; arguments?: Record<string, unknown> }[];
  voiceReply: { text: string; format: string };
  knowledge: { documentName: string; text: string; score: number }[];
  conversationId?: string;
}

const emptyOverview: AssistantOverview = {
  providers: { openai: false, gemini: false, claude: false, local: true },
  capabilities: [],
  metrics: {},
  recent: [],
};

const tasks = [
  { id: "full_analysis", label: "Full Analysis" },
  { id: "draft_reply", label: "Draft Reply" },
  { id: "faq", label: "FAQ / RAG" },
  { id: "lead_qualification", label: "Lead Qualification" },
  { id: "smart_follow_up", label: "Smart Follow Up" },
];

function metricValue(value?: number) {
  return Number(value || 0).toLocaleString();
}

function ProviderBadge({ name, enabled }: { name: string; enabled: boolean }) {
  return (
    <Badge variant={enabled ? "default" : "outline"} className="capitalize">
      {name} {enabled ? "ready" : "fallback"}
    </Badge>
  );
}

function OutputCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card className="rounded-lg border-border/70">
      <CardHeader className="flex-row items-center gap-2 px-4 pt-4">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 text-sm text-foreground">{children}</CardContent>
    </Card>
  );
}

export function AssistantView() {
  const [overview, setOverview] = useState<AssistantOverview>(emptyOverview);
  const [conversationId, setConversationId] = useState("");
  const [provider, setProvider] = useState("local");
  const [task, setTask] = useState("full_analysis");
  const [prompt, setPrompt] = useState("Summarize this customer, qualify the lead, detect intent, recommend the best product, and draft a helpful WhatsApp reply.");
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ messages?: any[]; knowledge?: any[] }>({});
  const [docName, setDocName] = useState("Product FAQ");
  const [docContent, setDocContent] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionLocked, setActionLocked] = useState("");

  function reportActionError(error: unknown, fallback: string) {
    if (isPlanLimitError(error)) setActionLocked(error.message);
    else setStatus(error instanceof Error ? error.message : fallback);
  }

  async function loadOverview() {
    const response = await getAssistantOverview<AssistantOverview>();
    setOverview(response);
  }

  useEffect(() => {
    loadOverview().catch(() => undefined);
  }, []);

  const selectedRecent = useMemo(() => overview.recent.find((item) => item.id === conversationId), [conversationId, overview.recent]);

  async function runAnalysis(nextTask = task) {
    setBusy(true);
    setStatus("");
    setActionLocked("");
    try {
      const response = await analyzeAssistantConversation<{ data: AssistantResult }>({ conversationId: conversationId || undefined, provider, task: nextTask, prompt });
      setResult(response.data);
      setStatus("Assistant analysis completed.");
      await loadOverview();
    } catch (error) {
      reportActionError(error, "Assistant failed.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadKnowledge() {
    if (!docContent.trim()) {
      setStatus("Paste document content before uploading.");
      return;
    }
    setBusy(true);
    setActionLocked("");
    try {
      const response = await uploadKnowledgeDocument<{ data: { chunks: number } }>({ name: docName, content: docContent, source: "rag_upload" });
      setStatus(`Knowledge indexed with ${response.data.chunks} chunks.`);
      setDocContent("");
    } catch (error) {
      reportActionError(error, "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runSearch() {
    setBusy(true);
    setActionLocked("");
    try {
      const response = await searchAssistant<{ data: { messages: any[]; knowledge: any[] } }>(searchQuery);
      setSearchResults(response.data);
      setStatus("Search completed.");
    } catch (error) {
      reportActionError(error, "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function transcribeVoice() {
    setActionLocked("");
    try {
      const response = await transcribeAssistantVoice<{ data: { transcript: string } }>({ fileName: "whatsapp-voice-note.ogg", transcript: voiceText });
      setVoiceText(response.data.transcript);
      setStatus("Voice transcription ready.");
    } catch (error) {
      reportActionError(error, "Voice transcription failed.");
    }
  }

  async function executeTool(call?: { name: string; arguments?: Record<string, unknown> }) {
    if (!call) return;
    setActionLocked("");
    try {
      const response = await runAssistantTool<{ data: { status: string } }>({ ...call, conversationId: result?.conversationId || conversationId });
      setStatus(`Tool ${call.name} ${response.data.status}.`);
    } catch (error) {
      reportActionError(error, "Tool call failed.");
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-3 md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles size={14} />
              <span>AI-powered WhatsApp assistant</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Assistant Studio</h1>
            <p className="text-sm text-muted-foreground">Summaries, auto replies, lead qualification, RAG, voice, memory, and workflow-ready tool calls.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(overview.providers).map(([name, enabled]) => (
              <ProviderBadge key={name} name={name} enabled={enabled} />
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["Conversations", overview.metrics.conversations, <MessageSquareText size={18} />],
            ["Analyzed", overview.metrics.analyzed, <BrainCircuit size={18} />],
            ["Automations", overview.metrics.automations, <Workflow size={18} />],
            ["Open Leads", overview.metrics.openLeads, <Tags size={18} />],
          ].map(([label, value, icon]) => (
            <Card key={String(label)} className="rounded-lg border-border/70">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">{icon}</div>
                <div>
                  <div className="text-xl font-semibold">{metricValue(value as number)}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
          <section className="space-y-4">
            <Card className="rounded-lg border-border/70">
              <CardHeader className="px-4 pt-4">
                <CardTitle className="text-sm font-semibold">Run Assistant</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-4">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Provider</span>
                  <select value={provider} onChange={(event) => setProvider(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none">
                    <option value="local">Local LLM / Rules</option>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Gemini</option>
                    <option value="claude">Claude</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Conversation ID</span>
                  <input value={conversationId} onChange={(event) => setConversationId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none" placeholder="Paste conversation id" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {tasks.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setTask(item.id);
                        runAnalysis(item.id);
                      }}
                      className={`h-9 rounded-md border px-2 text-xs transition-colors ${task === item.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm outline-none" />
                <Button onClick={() => runAnalysis()} disabled={busy} className="w-full">
                  {busy ? <Loader2 className="animate-spin" size={16} /> : <Bot size={16} />}
                  Analyze
                </Button>
                {selectedRecent && <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">{selectedRecent.customer}: {selectedRecent.summary}</div>}
              </CardContent>
            </Card>

            <Card className="rounded-lg border-border/70">
              <CardHeader className="px-4 pt-4">
                <CardTitle className="text-sm font-semibold">Recent AI Conversations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-4">
                {overview.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No analyzed conversations yet.</p>
                ) : (
                  overview.recent.map((item) => (
                    <button key={item.id} onClick={() => setConversationId(item.id)} className="w-full rounded-md border border-border p-3 text-left hover:bg-muted">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{item.customer}</span>
                        <Badge variant="outline">{item.score}</Badge>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.summary}</div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          </section>

          <section className="space-y-4">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 xl:grid-cols-2">
              <OutputCard title="Conversation Summary" icon={<BrainCircuit size={16} />}>
                {result?.summary || "Run analysis to generate a concise customer summary."}
              </OutputCard>
              <OutputCard title="Auto Reply and Drafts" icon={<Send size={16} />}>
                <div className="space-y-2">
                  <p>{result?.autoReply || "AI reply will appear here."}</p>
                  {result?.draftReplies?.map((draft, index) => (
                    <div key={`${draft}-${index}`} className="rounded-md bg-muted p-2 text-xs">{draft}</div>
                  ))}
                </div>
              </OutputCard>
              <OutputCard title="Intent, Sentiment and Lead Score" icon={<Lightbulb size={16} />}>
                <div className="grid gap-2 text-sm">
                  <div>Intent: <Badge variant="outline">{result?.intent?.label || "pending"}</Badge></div>
                  <div>Sentiment: <Badge variant="outline">{result?.sentiment?.label || "pending"}</Badge></div>
                  <div>Lead: <Badge>{result?.leadQualification?.stage || "pending"} {result?.leadQualification?.score || 0}</Badge></div>
                  <div className="text-xs text-muted-foreground">{result?.leadQualification?.reasons?.join(", ")}</div>
                </div>
              </OutputCard>
              <OutputCard title="Recommendation, FAQ and CRM Insights" icon={<PackageCheck size={16} />}>
                <div className="space-y-2">
                  <p>{result?.productRecommendation || "Product recommendation will appear here."}</p>
                  <p className="rounded-md bg-muted p-2 text-xs">{result?.faqAnswer || "RAG answer will appear after knowledge is uploaded."}</p>
                  <p className="text-xs text-muted-foreground">{result?.crmInsights?.nextBestAction || "Next best action pending."}</p>
                </div>
              </OutputCard>
            </motion.div>

            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="rounded-lg border-border/70 xl:col-span-1">
                <CardHeader className="px-4 pt-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold"><FileUp size={16} /> Knowledge Base / RAG</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-4 pb-4">
                  <input value={docName} onChange={(event) => setDocName(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none" />
                  <textarea value={docContent} onChange={(event) => setDocContent(event.target.value)} className="min-h-32 w-full rounded-md border border-input bg-background p-3 text-sm outline-none" placeholder="Paste FAQ, product docs, policies, pricing notes..." />
                  <Button onClick={uploadKnowledge} disabled={busy} className="w-full" variant="outline">
                    <FileUp size={16} />
                    Upload Document
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-lg border-border/70 xl:col-span-1">
                <CardHeader className="px-4 pt-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold"><Search size={16} /> Conversation Search</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-4 pb-4">
                  <div className="flex gap-2">
                    <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none" placeholder="Search messages or knowledge" />
                    <Button size="icon" variant="outline" onClick={runSearch}><Search size={16} /></Button>
                  </div>
                  <div className="max-h-52 space-y-2 overflow-auto text-xs">
                    {(searchResults.messages || []).map((item) => (
                      <div key={item.id} className="rounded-md bg-muted p-2">{item.customer}: {item.body}</div>
                    ))}
                    {(searchResults.knowledge || []).map((item, index) => (
                      <div key={`${item.documentName}-${index}`} className="rounded-md border border-border p-2">{item.documentName}: {item.text}</div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-lg border-border/70 xl:col-span-1">
                <CardHeader className="px-4 pt-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold"><AudioLines size={16} /> Voice and Tools</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-4 pb-4">
                  <textarea value={voiceText} onChange={(event) => setVoiceText(event.target.value)} className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm outline-none" placeholder="Paste voice transcript or leave blank for stub transcription" />
                  <Button variant="outline" onClick={transcribeVoice} className="w-full"><AudioLines size={16} /> Transcribe Voice</Button>
                  <div className="space-y-2">
                    {(result?.toolCalls || []).map((call) => (
                      <button key={call.name} onClick={() => executeTool(call)} className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">
                        <span>{call.name}</span>
                        <Play size={14} />
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-wrap gap-2">
              {overview.capabilities.map((capability) => (
                <Badge key={capability} variant="outline">{capability}</Badge>
              ))}
            </div>

            {status && <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{status}</div>}
            {actionLocked && <PlanLockedState title="This AI action is locked on your current plan" message={actionLocked} />}
          </section>
        </div>
      </div>
    </div>
  );
}
