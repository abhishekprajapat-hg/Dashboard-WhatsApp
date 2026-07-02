import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { MessageCircle, Eye, EyeOff } from "lucide-react";
import { login, type AuthSession } from "../lib/api";

interface LoginPageProps {
  onLogin: (session: AuthSession) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
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
    <div className="min-h-screen bg-background flex">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-card border-r border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <MessageCircle size={16} className="text-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground">WhatsCRM</span>
        </div>

        <div>
          <blockquote className="space-y-4">
            <p className="text-muted-foreground leading-relaxed text-sm">
              "WhatsCRM transformed how we handle customer support. We went from
              managing 200 WhatsApp conversations manually to automating 80% of
              first-response touchpoints across 12 agents - all from one dashboard."
            </p>
            <footer>
              <div className="text-foreground font-medium text-sm">Layla Al-Hassan</div>
              <div className="text-muted-foreground text-xs">Head of CX, Noor Retail Group</div>
            </footer>
          </blockquote>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Active workspaces", value: "1,240+" },
            { label: "Messages / month", value: "48M+" },
            { label: "Avg response time", value: "< 2 min" },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="text-xl font-semibold text-primary">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <MessageCircle size={16} className="text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">WhatsCRM</span>
          </div>

          <div>
            <h1 className="text-foreground">Sign in to your workspace</h1>
            <p className="text-muted-foreground text-sm mt-1">Enter your credentials to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="bg-input-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button type="button" className="text-xs text-primary hover:underline">
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
                  className="bg-input-background border-border text-foreground pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign in"}
            </Button>
            {notice && <p className="text-xs text-yellow-400">{notice}</p>}
          </form>

          <p className="text-xs text-center text-muted-foreground">
            Don't have an account?{" "}
            <button className="text-primary hover:underline">Request access</button>
          </p>
        </div>
      </div>
    </div>
  );
}


