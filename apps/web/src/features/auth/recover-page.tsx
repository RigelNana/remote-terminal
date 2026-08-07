import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { zh as zhKeys } from "@/lib/i18n/zh";
import { AuthShell } from "./login-page";

function errorMessage(code: string): string {
  const key = `error.${code}` as keyof typeof zhKeys;
  return key in zhKeys ? key : "error.UNKNOWN";
}

/** Recovery-code sign-in (PRD ID-003). */
export function RecoverPage() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !code.trim()) return;
    setBusy(true);
    try {
      await api.post("/v1/auth/recover", {
        username: username.trim(),
        code: code.trim().toUpperCase(),
      });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await router.navigate({ to: "/devices" });
    } catch (error) {
      toast.error(t(errorMessage(error instanceof ApiError ? error.code : "UNKNOWN") as never));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="mb-5 space-y-1">
        <p className="text-[15px] font-semibold text-ink">{t("auth.recoverTitle")}</p>
        <p className="text-[13px] leading-5 text-ink3">{t("auth.recoverSubtitle")}</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="recover-username">{t("auth.username")}</Label>
          <Input
            id="recover-username"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="recover-code">{t("auth.recoveryCode")}</Label>
          <Input
            id="recover-code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="readout"
            disabled={busy}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={busy || !username.trim() || !code.trim()}
        >
          <KeyRound />
          {t("auth.recoverSubmit")}
        </Button>
      </form>
    </AuthShell>
  );
}
