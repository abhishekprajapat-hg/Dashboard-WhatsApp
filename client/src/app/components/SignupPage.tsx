import { useState } from "react";
import { AlertCircle, Chrome, Facebook, Instagram, Loader2, MessageCircle, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { register, sendWhatsAppOtp, verifyWhatsAppOtp, completeOauthSignup, type AuthSession } from "../lib/api";
import { usePopupOAuth, type OAuthIdentity } from "../hooks/usePopupOAuth";

interface SignupPageProps {
  onSignup: (session: AuthSession) => void;
  onBackToLogin: () => void;
}

type SignupMode = "form" | "whatsapp";

export function SignupPage({ onSignup, onBackToLogin }: SignupPageProps) {
  const [mode, setMode] = useState<SignupMode>("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);

  const [pendingIdentity, setPendingIdentity] = useState<OAuthIdentity | null>(null);
  const [followUpEmail, setFollowUpEmail] = useState("");

  const { start: startOAuth, connectingProvider } = usePopupOAuth({
    onSession: onSignup,
    onNeedsEmail: (identity) => setPendingIdentity(identity),
    onError: (message) => setNotice(message),
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const session = await register({ name, email, password, workspaceName });
      onSignup(session);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create your account.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendOtp() {
    setOtpBusy(true);
    setNotice("");
    try {
      await sendWhatsAppOtp(phone);
      setOtpSent(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send a code.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function handleVerifyOtp() {
    setOtpBusy(true);
    setNotice("");
    try {
      const session = await verifyWhatsAppOtp(phone, otpCode);
      onSignup(session);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That code is incorrect or has expired.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function handleFollowUpEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!pendingIdentity) return;
    setLoading(true);
    setNotice("");
    try {
      const session = await completeOauthSignup({ continuationToken: pendingIdentity.continuationToken, email: followUpEmail });
      onSignup(session);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not finish signing up.");
    } finally {
      setLoading(false);
    }
  }

  if (pendingIdentity) {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-sm rounded-xl border border-border/90 bg-card/88 p-6 shadow-2xl">
          <h1 className="text-lg font-semibold text-foreground">One more thing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pendingIdentity.provider === "instagram" ? "Instagram" : "This provider"} doesn't share an email address - what's
            yours?
          </p>
          <form onSubmit={handleFollowUpEmail} className="mt-4 space-y-3">
            <Input
              type="email"
              value={followUpEmail}
              onChange={(e) => setFollowUpEmail(e.target.value)}
              placeholder="you@company.com"
              className="h-11"
              required
              autoFocus
            />
            {notice && <p className="text-sm text-destructive">{notice}</p>}
            <Button type="submit" size="xl" className="w-full" disabled={loading}>
              {loading ? "Finishing up..." : "Continue"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh w-full min-w-0 items-center justify-center overflow-x-hidden bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(37,211,102,0.16),transparent_30rem),radial-gradient(circle_at_82%_0%,rgba(79,140,255,0.12),transparent_28rem)]" />

      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-xl border border-border/90 bg-card/88 p-5 shadow-2xl shadow-black/35 backdrop-blur-xl sm:p-7">
          <div className="mb-6 space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <ShieldCheck size={13} />
              Create your workspace
            </div>
            <h1 className="text-2xl font-semibold leading-tight text-foreground">Get started with WhatsCRM</h1>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" className="h-10 border-border" onClick={() => startOAuth("google")} disabled={connectingProvider !== ""}>
              {connectingProvider === "google" ? <Loader2 size={16} className="animate-spin" /> : <Chrome size={16} />}
            </Button>
            <Button type="button" variant="outline" className="h-10 border-border" onClick={() => startOAuth("facebook")} disabled={connectingProvider !== ""}>
              {connectingProvider === "facebook" ? <Loader2 size={16} className="animate-spin" /> : <Facebook size={16} />}
            </Button>
            <Button type="button" variant="outline" className="h-10 border-border" onClick={() => startOAuth("instagram")} disabled={connectingProvider !== ""}>
              {connectingProvider === "instagram" ? <Loader2 size={16} className="animate-spin" /> : <Instagram size={16} />}
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            className="mt-2 h-10 w-full border-border"
            onClick={() => {
              setMode(mode === "whatsapp" ? "form" : "whatsapp");
              setNotice("");
            }}
          >
            <MessageCircle size={16} className="mr-2 text-primary" />
            {mode === "whatsapp" ? "Use email instead" : "Continue with WhatsApp"}
          </Button>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            {mode === "whatsapp" ? "WhatsApp verification" : "or sign up with email"}
            <div className="h-px flex-1 bg-border" />
          </div>

          {mode === "whatsapp" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>WhatsApp number</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" className="h-11" disabled={otpSent} />
              </div>
              {!otpSent ? (
                <Button type="button" size="xl" className="w-full" onClick={handleSendOtp} disabled={otpBusy || !phone}>
                  {otpBusy ? "Sending code..." : "Send code via WhatsApp"}
                </Button>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Enter the 6-digit code</Label>
                    <Input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="123456" className="h-11" maxLength={6} />
                  </div>
                  <Button type="button" size="xl" className="w-full" onClick={handleVerifyOtp} disabled={otpBusy || otpCode.length < 4}>
                    {otpBusy ? "Verifying..." : "Verify and continue"}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Your name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" required disabled={loading} />
              </div>
              <div className="space-y-2">
                <Label>Work email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="h-11" required disabled={loading} />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" required disabled={loading} />
              </div>
              <div className="space-y-2">
                <Label>Workspace name</Label>
                <Input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Your company name" className="h-11" required disabled={loading} />
              </div>
              <Button type="submit" size="xl" className="w-full" disabled={loading}>
                {loading && <Loader2 size={16} className="animate-spin" />}
                {loading ? "Creating your workspace..." : "Create account"}
              </Button>
            </form>
          )}

          {notice && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning" role="alert">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{notice}</span>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <button type="button" onClick={onBackToLogin} className="font-medium text-primary transition-colors hover:text-primary/80">
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
