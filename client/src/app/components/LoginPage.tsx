import { useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Bot,
  Eye,
  EyeOff,
  Loader2,
  Megaphone,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { login, type AuthSession } from "../lib/api";

interface LoginPageProps {
  onLogin: (session: AuthSession) => void;
  onRequestAccess: () => void;
}

const productPillars = [
  { label: "WhatsApp CRM", icon: MessageCircle },
  { label: "Automation", icon: Workflow },
  { label: "Campaigns", icon: Megaphone },
  { label: "Analytics", icon: BarChart3 },
];

const trustStats = [
  { label: "First response automation", value: "80%" },
  { label: "Campaign delivery tracking", value: "Live" },
  { label: "Workspace roles", value: "RBAC" },
];

export function LoginPage({ onLogin, onRequestAccess }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setNotice("");

    try {
      const session = await login(email, password);
      onLogin(session);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh w-full min-w-0 overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(37,211,102,0.16),transparent_30rem),radial-gradient(circle_at_82%_0%,rgba(79,140,255,0.12),transparent_28rem),linear-gradient(135deg,rgba(255,255,255,0.035),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.32))]" />

      <section className="relative z-10 hidden min-h-dvh w-[52%] flex-col justify-between border-r border-border/80 bg-surface/55 p-10 backdrop-blur-xl lg:flex xl:p-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex size-11 items-center justify-center rounded-xl border border-primary/25 bg-primary text-primary-foreground shadow-[0_18px_44px_rgba(37,211,102,0.2)]">
              <MessageCircle size={20} />
              <span className="absolute -right-1 -top-1 size-3 rounded-full border border-surface bg-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold">WhatsCRM</div>
              <div className="text-xs text-muted-foreground">WhatsApp Business command center</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <ShieldCheck size={13} />
            Secure workspace
          </div>
        </div>

        <div className="max-w-2xl space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/70 px-3 py-1 text-xs text-muted-foreground">
              <Sparkles size={13} className="text-primary" />
              Built for operators, sales teams, and support desks
            </div>
            <div className="space-y-4">
              <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-normal text-foreground xl:text-5xl">
                Run every WhatsApp conversation from one premium CRM.
              </h1>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground xl:text-base">
                Manage WhatsApp CRM, automation, campaigns, templates, analytics, and team handoffs without losing customer context.
              </p>
            </div>
          </div>

          <div className="grid max-w-xl grid-cols-2 gap-3">
            {productPillars.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <div key={pillar.label} className="flex items-center gap-3 rounded-lg border border-border/80 bg-card/70 p-3 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon size={17} />
                  </div>
                  <span className="text-sm font-medium text-foreground">{pillar.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {trustStats.map((stat) => (
            <div key={stat.label} className="rounded-lg border border-border/80 bg-card/55 p-4">
              <div className="text-xl font-semibold text-primary">{stat.value}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      <main className="relative z-10 flex min-h-dvh flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <MessageCircle size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold">WhatsCRM</div>
              <div className="text-xs text-muted-foreground">WhatsApp CRM and automation</div>
            </div>
          </div>

          <div className="rounded-xl border border-border/90 bg-card/88 p-5 shadow-2xl shadow-black/35 backdrop-blur-xl sm:p-7">
            <div className="mb-6 space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Bot size={13} />
                Automation-ready dashboard
              </div>
              <div>
                <h1 className="text-2xl font-semibold leading-tight text-foreground">Sign in to your workspace</h1>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Access your WhatsApp CRM, automations, campaigns, and analytics.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm text-foreground">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="h-11"
                  autoComplete="email"
                  disabled={loading}
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="password" className="text-sm text-foreground">
                    Password
                  </Label>
                  <button type="button" className="text-xs font-medium text-primary transition-colors hover:text-primary/80">
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="h-11 pr-11"
                    autoComplete="current-password"
                    disabled={loading}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {notice && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning" role="alert">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{notice}</span>
                </div>
              )}

              <Button type="submit" size="xl" className="w-full" disabled={loading}>
                {loading && <Loader2 size={16} className="animate-spin" />}
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <div className="mt-6 grid grid-cols-1 gap-2 text-xs text-muted-foreground min-[380px]:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-surface-subtle/70 p-3">
                <div className="font-medium text-foreground">Protected access</div>
                <div className="mt-1 leading-5">Workspace roles and permissions stay enforced.</div>
              </div>
              <div className="rounded-lg border border-border/70 bg-surface-subtle/70 p-3">
                <div className="font-medium text-foreground">Live operations</div>
                <div className="mt-1 leading-5">Inbox, campaigns, and analytics in one view.</div>
              </div>
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            Don't have an account?{" "}
            <button type="button" onClick={onRequestAccess} className="font-medium text-primary transition-colors hover:text-primary/80">
              Create one
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
