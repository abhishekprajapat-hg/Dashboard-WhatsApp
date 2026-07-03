import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Clock3,
  Edit3,
  Mail,
  MessageCircle,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { deleteTeamMember, getTeamMembers, inviteTeamMember, updateTeamMember } from "../lib/api";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "admin" | "manager" | "agent" | "viewer";
  status: "online" | "offline" | "busy" | "away";
  assignedConversations: number;
  resolvedToday: number;
  joinedAt: string;
  lastActive: string;
  avatar: string;
}

const roleStyle: Record<string, string> = {
  super_admin: "border-yellow-500/30 bg-yellow-500/15 text-yellow-300",
  admin: "border-blue-500/30 bg-blue-500/15 text-blue-300",
  manager: "border-primary/30 bg-primary/15 text-primary",
  agent: "border-border bg-secondary/70 text-foreground",
  viewer: "border-border bg-surface-elevated/45 text-muted-foreground",
};

const roleLabel: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  agent: "Agent",
  viewer: "Viewer",
};

const statusDot: Record<string, string> = {
  online: "bg-primary shadow-[0_0_0_3px_rgba(37,211,102,0.14)]",
  busy: "bg-destructive shadow-[0_0_0_3px_rgba(255,95,87,0.14)]",
  away: "bg-warning shadow-[0_0_0_3px_rgba(245,158,11,0.14)]",
  offline: "bg-muted-foreground/60",
};

const statusBadge: Record<string, string> = {
  online: "border-primary/30 bg-primary/10 text-primary",
  busy: "border-destructive/30 bg-destructive/10 text-destructive",
  away: "border-warning/30 bg-warning/10 text-warning",
  offline: "border-border bg-secondary/60 text-muted-foreground",
};

const statusLabel: Record<string, string> = {
  online: "Online",
  busy: "Busy",
  away: "Away",
  offline: "Offline",
};

const roleOptions = ["agent", "manager", "viewer", "admin"] as const;

const permissionsByRole: Record<string, string[]> = {
  super_admin: ["All workspaces", "Billing", "Security"],
  admin: ["Workspace admin", "Team", "Settings"],
  manager: ["Inbox routing", "CRM", "Reports"],
  agent: ["Inbox", "Contacts", "Replies"],
  viewer: ["Read-only", "Reports"],
};

const fieldClass = "h-9 border-border/80 bg-surface-elevated/45 text-sm";

interface TeamViewProps {
  canManage?: boolean;
}

function getInitials(member: TeamMember) {
  if (member.avatar?.trim()) return member.avatar.slice(0, 2).toUpperCase();
  const source = member.name?.trim() || member.email || "TM";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function TeamView({ canManage = false }: TeamViewProps) {
  const [search, setSearch] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editRole, setEditRole] = useState<TeamMember["role"]>("agent");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ name: "", email: "", role: "agent", password: "" });

  async function loadMembers() {
    setLoading(true);
    setError("");
    try {
      const response = await getTeamMembers<{ data: TeamMember[]; total: number }>();
      setMembers(response.data);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Team members could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMembers();
  }, []);

  const filtered = members.filter(
    (member) =>
      !search ||
      member.name.toLowerCase().includes(search.toLowerCase()) ||
      member.email.toLowerCase().includes(search.toLowerCase()) ||
      roleLabel[member.role].toLowerCase().includes(search.toLowerCase())
  );

  const onlineCount = members.filter((member) => member.status === "online" || member.status === "busy").length;
  const assignedCount = members.reduce((sum, member) => sum + member.assignedConversations, 0);
  const resolvedCount = members.reduce((sum, member) => sum + member.resolvedToday, 0);
  const adminCount = members.filter((member) => member.role === "admin" || member.role === "super_admin").length;

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    if (!form.email.trim()) return;

    setSaving(true);
    setNotice("");
    try {
      const response = await inviteTeamMember<{ data: TeamMember }>({
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        password: form.password,
      });
      setMembers((items) => [response.data, ...items.filter((item) => item.id !== response.data.id)]);
      setForm({ name: "", email: "", role: "agent", password: "" });
      setShowInvite(false);
    } catch (nextError) {
      setNotice(nextError instanceof Error ? nextError.message : "Could not invite member.");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(member: TeamMember) {
    setEditingMember(member);
    setEditRole(member.role);
    setNotice("");
  }

  async function handleEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingMember) return;

    setSaving(true);
    setNotice("");
    try {
      const response = await updateTeamMember<{ data: TeamMember }>(editingMember.id, { role: editRole });
      setMembers((items) => items.map((item) => (item.id === editingMember.id ? response.data : item)));
      setEditingMember(null);
    } catch (nextError) {
      setNotice(nextError instanceof Error ? nextError.message : "Could not update member.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const previous = members;
    setMembers((items) => items.filter((member) => member.id !== id));
    try {
      await deleteTeamMember(id);
    } catch (nextError) {
      setMembers(previous);
      setNotice(nextError instanceof Error ? nextError.message : "Could not remove member.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.10),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_28%)]">
      <div className="shrink-0 border-b border-border/70 px-3 py-4 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck size={14} className="text-primary" />
              <span>Tenant-aware team access</span>
              <Badge variant="outline" className="hidden sm:inline-flex">
                RBAC preserved
              </Badge>
            </div>
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">Team</h1>
            <p className="text-sm text-muted-foreground">
              {members.length} members, {onlineCount} active now, {adminCount} admin seats
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {error && (
              <Badge variant="destructive" className="max-w-full whitespace-normal">
                <AlertTriangle size={13} />
                {error}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={loadMembers} disabled={loading}>
              <Clock3 size={14} />
              Refresh
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => setShowInvite(!showInvite)}>
                <Plus size={14} />
                Invite member
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
          {canManage && showInvite && (
            <Card className="rounded-lg border-border/70 bg-card/90 p-4 shadow-xl shadow-black/10">
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <UserPlus size={16} className="text-primary" />
                      Invite a team member
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">Create access with the existing team invite API.</p>
                  </div>
                  <Badge variant="warning" className="w-fit">
                    Password is temporary
                  </Badge>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_1fr_180px_auto]">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Name</span>
                    <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Priya Sharma" className={fieldClass} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Email</span>
                    <Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="priya@company.com" className={fieldClass} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Temporary password</span>
                    <Input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Set a secure password" className={fieldClass} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Role</span>
                    <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} className={`${fieldClass} w-full rounded-md border px-3 text-foreground outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30`}>
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {roleLabel[role]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-end gap-2">
                    <Button type="submit" size="sm" className="h-9" disabled={saving}>
                      <Mail size={14} />
                      {saving ? "Saving" : "Save"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setShowInvite(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
                {notice && <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">{notice}</p>}
              </form>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Agents online", value: onlineCount, icon: <Users size={16} />, detail: "Online or busy", tone: "text-primary" },
              { label: "Open conversations", value: assignedCount, icon: <MessageCircle size={16} />, detail: "Assigned right now", tone: "text-blue-300" },
              { label: "Resolved today", value: resolvedCount, icon: <BadgeCheck size={16} />, detail: "Across all members", tone: "text-primary" },
              { label: "Admin seats", value: adminCount, icon: <Shield size={16} />, detail: "Elevated access", tone: "text-yellow-300" },
            ].map((item) => (
              <Card key={item.label} className="rounded-lg border-border/70 bg-card/90 p-4 shadow-xl shadow-black/5">
                <div className="flex items-center justify-between gap-3">
                  <div className={`flex size-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] ${item.tone}`}>{item.icon}</div>
                  <span className="text-[11px] text-muted-foreground">{item.detail}</span>
                </div>
                <div className="mt-4 text-2xl font-semibold tracking-normal text-foreground">{item.value}</div>
                <div className="text-xs text-muted-foreground">{item.label}</div>
              </Card>
            ))}
          </div>

          <Card className="rounded-lg border-border/70 bg-card/90 p-3 shadow-xl shadow-black/5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-sm">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, email, or role..." className="h-10 border-border/80 bg-surface-elevated/45 pl-9 text-sm" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {["online", "busy", "away", "offline"].map((status) => (
                  <Badge key={status} variant="outline" className={statusBadge[status]}>
                    <span className={`size-1.5 rounded-full ${statusDot[status]}`} />
                    {statusLabel[status]}
                  </Badge>
                ))}
              </div>
            </div>
          </Card>

          {notice && !showInvite && <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">{notice}</p>}

          {loading ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="rounded-lg border-border/70 bg-card/80 p-4">
                  <div className="flex animate-pulse gap-3">
                    <div className="size-12 rounded-full bg-secondary" />
                    <div className="flex-1 space-y-3">
                      <div className="h-3 w-1/3 rounded bg-secondary" />
                      <div className="h-3 w-1/2 rounded bg-secondary" />
                      <div className="flex gap-2">
                        <div className="h-6 w-20 rounded bg-secondary" />
                        <div className="h-6 w-24 rounded bg-secondary" />
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="rounded-lg border-border/70 bg-card/85 p-8 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground">
                <Users size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">{members.length === 0 ? "No team members yet" : "No matching members"}</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                {members.length === 0 ? "Invite your first teammate to start routing WhatsApp conversations." : "Try a different name, email, or role filter."}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {filtered.map((member) => (
                <Card key={member.id} className="group rounded-lg border-border/70 bg-card/90 p-4 shadow-xl shadow-black/5 transition-colors hover:border-primary/25 hover:bg-card">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <div className="relative shrink-0">
                        <div className="flex size-12 items-center justify-center rounded-full border border-border bg-gradient-to-br from-primary/20 via-blue-500/15 to-purple-500/15 text-sm font-semibold text-foreground">
                          {getInitials(member)}
                        </div>
                        <span className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-card ${statusDot[member.status]}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-foreground">{member.name || member.email}</h3>
                          <Badge variant="outline" className={roleStyle[member.role]}>
                            {roleLabel[member.role]}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{member.email}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(permissionsByRole[member.role] || []).map((permission) => (
                            <Badge key={permission} variant="outline" className="border-border/70 bg-surface-elevated/35 text-[10px] text-muted-foreground">
                              {permission}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline" className={statusBadge[member.status]}>
                        <span className={`size-1.5 rounded-full ${statusDot[member.status]}`} />
                        {statusLabel[member.status]}
                      </Badge>
                      {canManage && (
                        <>
                          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${member.name}`} onClick={() => openEdit(member)}>
                            <Edit3 size={14} />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${member.name}`} className="hover:text-destructive" onClick={() => handleDelete(member.id)}>
                            <Trash2 size={14} />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { label: "Assigned", value: member.assignedConversations },
                      { label: "Resolved", value: member.resolvedToday },
                      { label: "Last active", value: member.lastActive },
                      { label: "Joined", value: member.joinedAt },
                    ].map((item) => (
                      <div key={item.label} className="rounded-md border border-border/70 bg-surface-elevated/30 px-3 py-2">
                        <div className="text-[11px] text-muted-foreground">{item.label}</div>
                        <div className="mt-1 truncate text-xs font-medium text-foreground">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
          <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border-border/70 bg-card p-4 shadow-2xl">
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground">Edit member access</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{editingMember.email}</p>
                </div>
                <Badge variant="outline" className={statusBadge[editingMember.status]}>
                  {statusLabel[editingMember.status]}
                </Badge>
              </div>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Role</span>
                <select value={editRole} onChange={(event) => setEditRole(event.target.value as TeamMember["role"])} className={`${fieldClass} w-full rounded-md border px-3 text-foreground outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30`}>
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel[role]}
                    </option>
                  ))}
                  {editingMember.role === "super_admin" && <option value="super_admin">Super Admin</option>}
                </select>
              </label>
              <div className="rounded-md border border-border/70 bg-surface-elevated/35 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Permission summary</div>
                <div className="flex flex-wrap gap-1.5">
                  {(permissionsByRole[editRole] || []).map((permission) => (
                    <Badge key={permission} variant="outline">
                      {permission}
                    </Badge>
                  ))}
                </div>
              </div>
              {notice && <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">{notice}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditingMember(null)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? "Saving" : "Save role"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
