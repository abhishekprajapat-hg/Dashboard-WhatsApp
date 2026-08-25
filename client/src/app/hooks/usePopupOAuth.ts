import { useCallback, useRef, useState } from "react";
import { getOauthAuthorizeUrl, type AuthSession } from "../lib/api";

export type OAuthProvider = "google" | "facebook" | "instagram";

interface SocialAuthCallbackPayload {
  type: "SOCIAL_AUTH_CALLBACK";
  provider: OAuthProvider;
  session?: AuthSession;
  needsEmail?: boolean;
  providerId?: string;
  name?: string;
  avatarUrl?: string;
  error?: string;
}

export interface OAuthIdentity {
  provider: OAuthProvider;
  providerId: string;
  name: string;
  avatarUrl: string;
}

interface UsePopupOAuthOptions {
  onSession: (session: AuthSession) => void;
  onNeedsEmail: (identity: OAuthIdentity) => void;
  onError: (message: string) => void;
}

// Generalizes InstagramSettingsPanel.tsx's proven popup + localStorage + "storage"-event mechanic
// (not window.opener/postMessage, which real COOP breakage already ruled out in production for
// that flow) across Google/Facebook/Instagram end-user login, instead of copy-pasting it three
// times. Shared with server/routes/auth.js's "social_auth_result" localStorage key.
export function usePopupOAuth({ onSession, onNeedsEmail, onError }: UsePopupOAuthOptions) {
  const [connectingProvider, setConnectingProvider] = useState<OAuthProvider | "">("");
  const popupRef = useRef<Window | null>(null);
  const processedRef = useRef(false);

  function handleResult(raw: string) {
    if (processedRef.current) return;
    let data: SocialAuthCallbackPayload;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (data?.type !== "SOCIAL_AUTH_CALLBACK") return;
    processedRef.current = true;
    localStorage.removeItem("social_auth_result");
    setConnectingProvider("");

    if (data.error) {
      onError(data.error);
      return;
    }
    if (data.needsEmail) {
      onNeedsEmail({ provider: data.provider, providerId: data.providerId || "", name: data.name || "", avatarUrl: data.avatarUrl || "" });
      return;
    }
    if (data.session) {
      onSession(data.session);
    }
  }

  const start = useCallback(async (provider: OAuthProvider) => {
    processedRef.current = false;
    localStorage.removeItem("social_auth_result");
    setConnectingProvider(provider);

    try {
      const response = await getOauthAuthorizeUrl(provider);
      popupRef.current = window.open(response.url, "social_oauth", "width=520,height=720");

      function onStorage(event: StorageEvent) {
        if (event.key !== "social_auth_result" || !event.newValue) return;
        window.removeEventListener("storage", onStorage);
        handleResult(event.newValue);
      }
      window.addEventListener("storage", onStorage);

      // Fallback for the (rare, browser-dependent) case where the "storage" event doesn't fire in
      // time or at all - same precedent as InstagramSettingsPanel.tsx's own popup flow.
      const pollId = window.setInterval(() => {
        if (!popupRef.current || popupRef.current.closed) {
          window.clearInterval(pollId);
          window.removeEventListener("storage", onStorage);
          const stored = localStorage.getItem("social_auth_result");
          if (stored) {
            handleResult(stored);
          } else {
            setConnectingProvider("");
          }
        }
      }, 500);
    } catch (error) {
      setConnectingProvider("");
      onError(error instanceof Error ? error.message : `${provider} login is not available.`);
    }
  }, []);

  return { start, connectingProvider };
}
