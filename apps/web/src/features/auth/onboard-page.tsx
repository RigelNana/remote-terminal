import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { CheckCircle2, Copy, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { zh as zhKeys } from "@/lib/i18n/zh";
import { AuthShell } from "./login-page";
import { createPasskey, webauthnSupported } from "./webauthn";

function errorMessage(code: string): string {
  const key = `error.${code}` as keyof typeof zhKeys;
  return key in zhKeys ? key : "error.UNKNOWN";
}

/** First-run onboarding: register the admin passkey, show recovery codes once. */
export function OnboardPage() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearch({ from: "/onboard" });
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const register = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !search.bootstrap) return;
    if (!webauthnSupported()) {
      toast.error(t("auth.webauthnUnsupported"));
      return;
    }
    setBusy(true);
    try {
      const name = username.trim();
      const { ceremony, public_key } = await api.post<{ ceremony: string; public_key: unknown }>(
        "/v1/auth/register/start",
        {
          bootstrap: search.bootstrap,
          credential_name: "Primary passkey",
          display_name: name,
          username: name,
        },
      );
      const credential = await createPasskey(public_key);
      const registered = await api.post<{ user: unknown; recovery_codes: string[] }>(
        "/v1/auth/register/finish",
        { ceremony, credential },
      );
      setCodes(registered.recovery_codes);
    } catch (error) {
      toast.error(t(errorMessage(error instanceof ApiError ? error.code : "UNKNOWN") as never));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    await router.navigate({ to: "/devices" });
  };

  if (codes) {
    return (
      <AuthShell>
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-[15px] font-semibold text-ink">{t("onboard.recoveryTitle")}</p>
            <p className="text-[13px] leading-5 text-ink3">{t("onboard.recoveryIntro")}</p>
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-bg p-3">
            {codes.map((code) => (
              <li key={code} className="readout truncate text-xs text-ink">
                {code}
              </li>
            ))}
          </ul>
          <div className="rounded-[var(--radius-control)] border border-warn/40 bg-warn/8 px-3 py-2 text-xs text-warn">
            {t("onboard.recoveryWarn")}
          </div>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              void navigator.clipboard.writeText(codes.join("\n"));
              toast.success(t("onboard.recoveryCopied"));
            }}
          >
            <Copy />
            {t("common.copy")}
          </Button>
          <Button variant="primary" className="w-full" onClick={() => void finish()}>
            <CheckCircle2 />
            {t("onboard.recoveryConfirm")}
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-5 space-y-1">
        <p className="text-[15px] font-semibold text-ink">{t("onboard.title")}</p>
        <p className="text-[13px] leading-5 text-ink3">{t("onboard.subtitle")}</p>
      </div>
      {!search.bootstrap ? (
        <p className="rounded-[var(--radius-control)] border border-bad/40 bg-bad/8 px-3 py-2.5 text-[13px] text-bad">
          {t("onboard.bootstrapInvalid")}
        </p>
      ) : (
        <form onSubmit={register} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="onboard-username">{t("onboard.username")}</Label>
            <Input
              id="onboard-username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={busy}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={busy || !username.trim()}
          >
            <ShieldCheck />
            {busy ? t("onboard.creating") : t("onboard.create")}
          </Button>
          <p className="text-center text-xs text-ink3">{t("auth.registerSubtitle")}</p>
        </form>
      )}
    </AuthShell>
  );
}
