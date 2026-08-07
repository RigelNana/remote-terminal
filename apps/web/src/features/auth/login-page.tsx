import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api";
import { errorKey } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { getPasskey, webauthnSupported } from "./webauthn";

/** Passkey sign-in (PRD ID-002). */
export function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearch({ from: "/login" });
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim()) return;
    if (!webauthnSupported()) {
      toast.error(t("auth.webauthnUnsupported"));
      return;
    }
    setBusy(true);
    try {
      const { ceremony, public_key } = await api.post<{ ceremony: string; public_key: unknown }>(
        "/v1/auth/login/start",
        { username: username.trim() },
      );
      const credential = await getPasskey(public_key);
      await api.post("/v1/auth/login/finish", { ceremony, credential });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      const target = search.redirect === "/workspace" ? "/workspace" : "/devices";
      await router.navigate({ to: target });
    } catch (error) {
      toast.error(t(errorKey(error instanceof ApiError ? error.code : "UNKNOWN") as never));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="username">{t("auth.username")}</Label>
          <Input
            id="username"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="admin"
            disabled={busy}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={busy || !username.trim()}
        >
          <KeyRound />
          {busy ? t("common.loading") : t("auth.continue")}
        </Button>
        <p className="text-center text-xs text-ink3">{t("auth.webauthnPrompt")}</p>
        <div className="flex justify-center gap-4 border-t border-line pt-3 text-xs">
          <Link to="/recover" className="text-ink3 transition-colors hover:text-ink2">
            {t("auth.recoverTitle")}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <span className="silkscreen text-lg text-ink">REMOTE TERMINAL</span>
          <span className="silkscreen flex items-center gap-1.5 text-ink3">
            <ShieldCheck className="size-3.5 text-ok" />
            OBSERVATORY ACCESS
          </span>
        </div>
        <div className="rounded-[var(--radius-dialog)] border border-line2 bg-panel2 p-6 shadow-[var(--shadow-pop)]">
          {children}
        </div>
      </div>
    </div>
  );
}
