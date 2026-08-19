import { useRef, useState } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Facebook } from "lucide-react";
import { completeEmbeddedSignup } from "../lib/api";

// WhatsApp Embedded Signup v4: a client authorizes their own WABA in a Facebook-hosted popup and
// we never see their Meta password - the popup hands back an authorization code (via FB.login's
// own callback) and the chosen WABA/phone number IDs (via a separate window postMessage event),
// independently of each other. Both have to arrive before the flow can be completed server-side.

const FB_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const GRAPH_API_VERSION = "v21.0";

declare global {
  interface Window {
    FB?: {
      init: (config: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        options: { config_id: string; response_type: string; override_default_response_type: boolean; extras: { setup: Record<string, unknown> } }
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

let sdkLoadPromise: Promise<void> | null = null;

function loadFacebookSdk(appId: string): Promise<void> {
  if (window.FB) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise((resolve) => {
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: true, version: GRAPH_API_VERSION });
      resolve();
    };
    const script = document.createElement("script");
    script.src = FB_SDK_SRC;
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  });
  return sdkLoadPromise;
}

interface EmbeddedSignupResult {
  accountId: string;
  pin: string;
}

interface EmbeddedSignupButtonProps {
  onConnected: (result: EmbeddedSignupResult) => void;
}

export function EmbeddedSignupButton({ onConnected }: EmbeddedSignupButtonProps) {
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState("");
  const wabaData = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);

  const appId = import.meta.env.VITE_META_APP_ID || "";
  const configId = import.meta.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID || "";
  const notConfigured = !appId || !configId;

  async function finishIfReady(code: string) {
    if (!wabaData.current) return;
    setConnecting(true);
    setNotice("");
    try {
      const response = await completeEmbeddedSignup<{ data: { id: string }; pin: string }>({
        code,
        wabaId: wabaData.current.wabaId,
        phoneNumberId: wabaData.current.phoneNumberId,
      });
      onConnected({ accountId: response.data.id, pin: response.pin });
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Embedded Signup could not be completed.");
    } finally {
      setConnecting(false);
      wabaData.current = null;
    }
  }

  async function handleConnect() {
    if (notConfigured) return;
    setNotice("");
    await loadFacebookSdk(appId);

    function messageListener(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.data?.waba_id && data?.data?.phone_number_id) {
          wabaData.current = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id };
        }
      } catch {
        // Not every message on the page is ours to parse - ignore anything that isn't real JSON.
      }
    }
    window.addEventListener("message", messageListener);

    window.FB?.login(
      (response) => {
        window.removeEventListener("message", messageListener);
        const code = response.authResponse?.code;
        if (!code) {
          setNotice("Embedded Signup was cancelled or did not return an authorization code.");
          return;
        }
        // The postMessage event can arrive slightly before or after this callback - give it one
        // tick either way rather than assuming an exact order.
        setTimeout(() => finishIfReady(code), 300);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      }
    );
  }

  return (
    <Card className="p-4 rounded-lg border-border bg-card/90 shadow-xl shadow-black/5">
      <div className="flex items-center gap-2 mb-1">
        <Facebook size={16} className="text-primary" />
        <h3 className="text-sm font-medium text-foreground">Connect with Facebook</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Let a client connect their own WhatsApp Business Account directly - no phone number ID, business account ID, or
        access token to hunt down and hand over manually.
      </p>
      {notConfigured ? (
        <p className="text-xs text-yellow-300">
          Not configured yet - set VITE_META_APP_ID and VITE_META_EMBEDDED_SIGNUP_CONFIG_ID (the latter comes from
          App Dashboard → Facebook Login for Business → Configurations).
        </p>
      ) : (
        <Button type="button" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" onClick={handleConnect} disabled={connecting}>
          {connecting ? "Connecting..." : "Connect with Facebook"}
        </Button>
      )}
      {notice && <p className="mt-2 text-xs text-destructive">{notice}</p>}
    </Card>
  );
}
