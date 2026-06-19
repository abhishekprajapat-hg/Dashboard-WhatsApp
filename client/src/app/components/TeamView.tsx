import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Plus, Search, Mail, MoreHorizontal, Shield, Users, MessageCircle, Trash2 } from "lucide-react";
import { deleteTeamMember, getTeamMembers, inviteTeamMember, updateTeamMember } from "../lib/api";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "admin" | "agent";
  status: "online" | "offline" | "busy" | "away";
  assignedConversations: number;
  resolvedToday: number;
  joinedAt: string;
  lastActive: string;
  avatar: string;
}

const roleStyle: Record<string, string> = {
  super_admin: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  admin: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  agent: "bg-secondary text-muted-foreground border-border",
};

const roleLabel: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  agent: "Agent",
};

const statusDot: Record<string, string> = {
  online: "bg-primary",
  busy: "bg-red-500",
  away: "bg-yellow-400",
  offline: "bg-muted-foreground",
};

const statusLabel: Record<string, string> = {
  online: "Online",
  busy: "Busy",
  away: "Away",
  offline: "Offline",
};

export function TeamView() {
  const [search, setSearch] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "agent", password: "123456" });

  async function loadMembers() {
    const response = await getTeamMembers<{ data: TeamMember[]; total: number }>();
    setMembers(response.data);
  }

  useEffect(() => {
    loadMembers().catch(() => undefined);
  }, []);

  const filtered = members.filter(
    (member) =>
      !search ||
      member.name.toLowerCase().includes(search.toLowerCase()) ||
      member.email.toLowerCase().includes(search.toLowerCase())
  );

  const onlineCount = members.filter((member) => member.status === "online" || member.status === "busy").length;

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!form.email.trim()) return;

    setSaving(true);
    try {
      const response = await inviteTeamMember<{ data: TeamMember }>({
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        password: form.password || "123456",
      });
      setMembers((items) => [response.data, ...items.filter((item) => item.id !== response.data.id)]);
      setForm({ name: "", email: "", role: "agent", password: "123456" });
      setShowInvite(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleRole(member: TeamMember, role: string) {
    const response = await updateTeamMember<{ data: TeamMember }>(member.id, { role });
    setMembers((items) => items.map((item) => (item.id === member.id ? response.data : item)));
  }

  async function handleDelete(id: string) {
    setMembers((items) => items.filter((member) => member.id !== id));
    await deleteTeamMember(id).catch(() => undefined);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-foreground">Team</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{members.length} members - {onlineCount} online now</p>
        </div>
        <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowInvite(!showInvite)}>
          <Plus size={13} className="mr-1.5" /> Invite member
        </Button>
      </div>

      {showInvite && (
        <form onSubmit={handleInvite} className="mx-6 mt-4 p-4 rounded-lg bg-card border border-border">
          <h3 className="text-sm font-medium text-foreground mb-3">Invite a team member</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Name" className="h-8 text-xs bg-secondary border-transparent" />
            <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="Email address" className="h-8 text-xs bg-secondary border-transparent" />
            <Input value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password" className="h-8 text-xs bg-secondary border-transparent" />
            <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} className="h-8 text-xs bg-secondary border border-border rounded-md px-2 text-foreground">
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
            <div className="flex gap-2">
              <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90" disabled={saving}>
                <Mail size={12} className="mr-1" /> {saving ? "Saving..." : "Save"}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-border text-muted-foreground" onClick={() => setShowInvite(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      )}

      <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-border shrink-0">
        {[
          { label: "Agents online", value: onlineCount, icon: <Users size={14} className="text-primary" /> },
          { label: "Open conversations", value: members.reduce((sum, member) => sum + member.assignedConversations, 0), icon: <MessageCircle size={14} className="text-blue-400" /> },
          { label: "Resolved today", value: members.reduce((sum, member) => sum + member.resolvedToday, 0), icon: <Shield size={14} className="text-primary" /> },
        ].map((item) => (
          <Card key={item.label} className="p-3 bg-card border-border">
            <div className="flex items-center gap-2 mb-1">{item.icon}</div>
            <div className="text-lg font-semibold text-foreground">{item.value}</div>
            <div className="text-[11px] text-muted-foreground">{item.label}</div>
          </Card>
        ))}
      </div>

      <div className="px-6 py-3 border-b border-border shrink-0">
        <div className="relative max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search members..." className="pl-8 h-8 text-xs bg-secondary border-transparent focus:border-border" />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/50 sticky top-0">
              <th className="px-6 py-2.5 text-left font-medium text-muted-foreground">Member</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Role</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground hidden sm:table-cell">Assigned</th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground hidden md:table-cell">Resolved today</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">Last active</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">Joined</th>
              <th className="px-3 py-2.5 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((member) => (
              <tr key={member.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                <td className="px-6 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                        <span className="text-[11px] font-semibold text-foreground">{member.avatar}</span>
                      </div>
                      <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-background ${statusDot[member.status]}`} />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{member.name}</div>
                      <div className="text-[11px] text-muted-foreground">{member.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <button onClick={() => handleRole(member, member.role === "admin" ? "agent" : "admin")}>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${roleStyle[member.role]}`}>
                      {roleLabel[member.role]}
                    </Badge>
                  </button>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDot[member.status]}`} />
                    <span className="text-muted-foreground">{statusLabel[member.status]}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-right text-foreground hidden sm:table-cell">{member.assignedConversations}</td>
                <td className="px-3 py-3 text-right hidden md:table-cell">
                  <span className={member.resolvedToday > 0 ? "text-primary font-medium" : "text-muted-foreground"}>{member.resolvedToday}</span>
                </td>
                <td className="px-3 py-3 text-muted-foreground hidden lg:table-cell">{member.lastActive}</td>
                <td className="px-3 py-3 text-muted-foreground hidden lg:table-cell">{member.joinedAt}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1">
                    <button className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors" onClick={() => handleDelete(member.id)}>
                      <Trash2 size={13} />
                    </button>
                    <button className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                      <MoreHorizontal size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
