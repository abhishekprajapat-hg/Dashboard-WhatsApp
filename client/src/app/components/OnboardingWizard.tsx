import { useEffect, useState } from "react";
import { Building2, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { EmbeddedSignupButton } from "./EmbeddedSignupButton";
import { BrandMark } from "./shell/BrandMark";
import { getOnboardingIndustryPacks, provisionIndustryPack, type OnboardingIndustryPack } from "../lib/api";

interface OnboardingWizardProps {
  workspaceName: string;
  onFinish: () => void;
}

function groupByVertical(packs: OnboardingIndustryPack[]) {
  const groups = new Map<string, OnboardingIndustryPack[]>();
  for (const pack of packs) {
    const vertical = pack.label.split(" - ")[0] || pack.industry;
    if (!groups.has(vertical)) groups.set(vertical, []);
    groups.get(vertical)!.push(pack);
  }
  return Array.from(groups.entries());
}

function IndustryPickerStep({ onDone }: { onDone: () => void }) {
  const [packs, setPacks] = useState<OnboardingIndustryPack[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [applyingKey, setApplyingKey] = useState("");
  const [applyError, setApplyError] = useState("");
  const [appliedKey, setAppliedKey] = useState("");

  useEffect(() => {
    getOnboardingIndustryPacks<{ data: OnboardingIndustryPack[] }>()
      .then((response) => setPacks(response.data))
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load industry packs."));
  }, []);

  async function handleUse(pack: OnboardingIndustryPack) {
    setApplyingKey(pack.key);
    setApplyError("");
    try {
      await provisionIndustryPack(pack.key);
      setAppliedKey(pack.key);
      setTimeout(onDone, 600);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "Could not apply this industry pack.");
    } finally {
      setApplyingKey("");
    }
  }

  return (
    <div className="w-full max-w-2xl space-y-4">
      <div className="text-center">
        <h1 className="font-serif text-[30px] leading-tight text-foreground">Set up your workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick the closest match to your business and we'll pre-load your pipeline stages, custom fields, and starter
          message templates.
        </p>
      </div>

      {loadError && <p className="text-center text-xs text-destructive">{loadError}</p>}
      {applyError && <p className="text-center text-xs text-destructive">{applyError}</p>}

      {!packs && !loadError && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Loading industry packs...
        </div>
      )}

      {packs && packs.length > 0 && (
        <div className="max-h-[50vh] space-y-5 overflow-y-auto pr-1">
          {groupByVertical(packs).map(([vertical, verticalPacks]) => (
            <div key={vertical}>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Building2 size={13} />
                {vertical}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {verticalPacks.map((pack) => {
                  const isApplying = applyingKey === pack.key;
                  const isApplied = appliedKey === pack.key;
                  return (
                    <Card key={pack.key} className="p-4">
                      <p className="text-sm font-medium text-foreground">{pack.label.split(" - ").slice(1).join(" - ") || pack.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{pack.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="outline">{pack.pipelineStageCount} stages</Badge>
                        <Badge variant="outline">{pack.customFieldCount} fields</Badge>
                        <Badge variant="outline">{pack.templateCount} templates</Badge>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-3 h-8 w-full text-xs bg-primary text-primary-foreground"
                        onClick={() => handleUse(pack)}
                        disabled={Boolean(applyingKey) || Boolean(appliedKey)}
                      >
                        {isApplied ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 size={14} /> Applied
                          </span>
                        ) : isApplying ? (
                          "Applying..."
                        ) : (
                          "Use this pack"
                        )}
                      </Button>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-center">
        <button type="button" onClick={onDone} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Skip for now
        </button>
      </div>
    </div>
  );
}

function WhatsAppConnectStep({ workspaceName, onDone }: { workspaceName: string; onDone: () => void }) {
  return (
    <div className="w-full max-w-md space-y-4">
      <div className="text-center">
        <h1 className="font-serif text-[30px] leading-tight text-foreground">Welcome to {workspaceName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Connect your WhatsApp Business number to start receiving conversations.</p>
      </div>
      <EmbeddedSignupButton onConnected={onDone} />
      <Button type="button" variant="outline" className="w-full border-border" onClick={onDone}>
        Skip for now
      </Button>
    </div>
  );
}

export function OnboardingWizard({ workspaceName, onFinish }: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);

  return (
    <div className="flex min-h-dvh w-full justify-center overflow-y-auto bg-background px-4 py-10 text-foreground sm:py-14">
      <div className="flex w-full max-w-2xl flex-col items-center gap-6">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BrandMark className="size-6" />
        </span>
        <div className="grid w-full max-w-xs gap-2 text-center">
          <p className="text-[12px] font-medium text-muted-foreground">
            {step === 1 ? "Step 1 of 2 · Your industry" : "Step 2 of 2 · Connect WhatsApp"}
          </p>
          <div className="grid grid-cols-2 gap-1.5" aria-hidden>
            <span className="h-1 rounded-full bg-primary" />
            <span className={`h-1 rounded-full ${step === 2 ? "bg-primary" : "bg-secondary"}`} />
          </div>
        </div>
        {step === 1 ? (
          <IndustryPickerStep onDone={() => setStep(2)} />
        ) : (
          <WhatsAppConnectStep workspaceName={workspaceName} onDone={onFinish} />
        )}
      </div>
    </div>
  );
}
