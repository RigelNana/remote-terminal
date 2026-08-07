import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";

export interface PasteRisk {
  text: string;
  lines: number;
  chars: number;
  control: boolean;
}

/**
 * Paste review (PRD IO-005): multi-line, oversized, or control-character
 * pastes must be previewed before they reach the shell. Per-session opt-out.
 */
export function PasteGuard({
  risk,
  onConfirm,
  onDeny,
}: {
  risk: PasteRisk;
  onConfirm: (allowSession: boolean) => void;
  onDeny: () => void;
}) {
  const { t } = useI18n();
  const [allowSession, setAllowSession] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onDeny()}>
      <DialogContent>
        <DialogHeader title={t("session.pasteWarn")} description={t("session.pasteTitle")} />
        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-warn/40 bg-warn/8 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <div className="space-y-0.5">
              <p className="text-[13px] font-medium text-ink">
                {t("session.pasteLines", { lines: risk.lines, chars: risk.chars })}
              </p>
              {risk.control ? (
                <p className="text-xs text-warn">{t("session.pasteControl")}</p>
              ) : null}
            </div>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] border border-line bg-bg px-3 py-2 text-xs leading-5 text-ink2">
            {risk.text.slice(0, 2000)}
            {risk.text.length > 2000 ? "…" : ""}
          </pre>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink2">
            <Switch checked={allowSession} onCheckedChange={setAllowSession} />
            {t("session.pasteAllow")}
          </label>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" onClick={onDeny}>
              {t("session.pasteDeny")}
            </Button>
          </DialogClose>
          <Button variant="primary" onClick={() => onConfirm(allowSession)}>
            {t("session.pasteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
