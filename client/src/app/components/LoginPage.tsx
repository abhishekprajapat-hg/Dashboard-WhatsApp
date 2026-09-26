import { useState } from "react";
import { AlertCircle, Chrome, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { forgotPassword, login, completeOauthSignup, type AuthSession } from "../lib/api";
import { usePopupOAuth, type OAuthIdentity } from "../hooks/usePopupOAuth";
import { AuthShell } from "./shell/AuthShell";

interface LoginPageProps {
  onLogin: (session: AuthSession) => void;
  onRequestAccess: () => void;
}

export function LoginPage({ onLogin, onRequestAccess }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [forgotSent, setForgotSent] = useState(false);

  const [pendingIdentity, setPendingIdentity] = useState<OAuthIdentity | null>(null);
  const [followUpEmail, setFollowUpEmail] = useState("");

  const { start: startOAuth, connectingProvider } = usePopupOAuth({
    onSession: onLogin,
    onNeedsEmail: (identity) => setPendingIdentity(identity),
    onError: (message) => setNotice(message),
  });

  async function handleFollowUpEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingIdentity) return;
    setLoading(true);
    setNotice("");
    try {
      const session = await completeOauthSignup({ continuationToken: pendingIdentity.continuationToken, email: followUpEmail });
      onLogin(session);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not finish signing in.");
    } finally {
      setLoading(false);
    }
  }

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

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      await forgotPassword(email);
      setForgotSent(true);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not send the reset email. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function backToLogin() {
    setMode("login");
    setForgotSent(false);
    setNotice("");
  }

  if (pendingIdentity) {
    return (
      <AuthShell>
          <h1 className="text-xl font-semibold text-foreground">One more thing</h1>
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
      </AuthShell>
    );
  }

  return (
    <AuthShell
      footer={
        <>
          <p className="mt-5 text-center text-[13px] text-muted-foreground">
            Don't have an account?{" "}
            <button type="button" onClick={onRequestAccess} className="font-medium text-primary transition-colors hover:text-primary/80">
              Create one
            </button>
          </p>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            <a href="/legal/privacy" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">
              Privacy Policy
            </a>
            <span className="mx-2 opacity-50">&middot;</span>
            <a href="/legal/terms-of-service" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">
              Terms
            </a>
            <span className="mx-2 opacity-50">&middot;</span>
            <a href="/legal/data-deletion" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">
              Data Deletion
            </a>
          </p>
        </>
      }
    >
            {mode === "forgot" ? (
              <>
                <div className="mb-6 space-y-2">
                  <div>
                    <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-foreground">Reset your password</h1>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Enter your account email and we'll send a reset link if it's registered.
                    </p>
                  </div>
                </div>

                {forgotSent ? (
                  <div className="space-y-4">
                    <div className="rounded-lg bg-success/12 px-3 py-2.5 text-sm text-foreground">
                      If that email is registered, a reset link is on its way. Check your inbox.
                    </div>
                    <Button type="button" variant="outline" size="xl" className="w-full" onClick={backToLogin}>
                      Back to sign in
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="forgot-email" className="text-sm text-foreground">
                        Email address
                      </Label>
                      <Input
                        id="forgot-email"
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

                    {notice && (
                      <div className="flex items-start gap-2 rounded-lg bg-problem-soft px-3 py-2 text-sm text-destructive" role="alert">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                        <span>{notice}</span>
                      </div>
                    )}

                    <Button type="submit" size="xl" className="w-full" disabled={loading}>
                      {loading && <Loader2 size={16} className="animate-spin" />}
                      {loading ? "Sending..." : "Send reset link"}
                    </Button>
                    <button type="button" onClick={backToLogin} className="w-full text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                      Back to sign in
                    </button>
                  </form>
                )}
              </>
            ) : (
              <>
                <div className="mb-6 space-y-2">
                  <div>
                    <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-foreground">Sign in</h1>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Welcome back. Your inbox, leads and automations are waiting.
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="xl"
                  className="w-full border-border"
                  onClick={() => startOAuth("google")}
                  disabled={connectingProvider !== ""}
                >
                  {connectingProvider === "google" ? <Loader2 size={16} className="animate-spin" /> : <Chrome size={16} className="mr-2" />}
                  {connectingProvider === "google" ? "Connecting..." : "Continue with Google"}
                </Button>

                <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  or sign in with email
                  <div className="h-px flex-1 bg-border" />
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
                      <button type="button" onClick={() => setMode("forgot")} className="text-xs font-medium text-primary transition-colors hover:text-primary/80">
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
                    <div className="flex items-start gap-2 rounded-lg bg-problem-soft px-3 py-2 text-sm text-destructive" role="alert">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <span>{notice}</span>
                    </div>
                  )}

                  <Button type="submit" size="xl" className="w-full" disabled={loading}>
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    {loading ? "Signing in..." : "Sign in"}
                  </Button>
                </form>
              </>
            )}

    </AuthShell>
  );
}
