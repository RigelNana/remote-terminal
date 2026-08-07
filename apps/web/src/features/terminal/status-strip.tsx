import { ShieldCheck } from "lucide-react";

import { Lamp } from "@/components/rack/lamp";
import { Readout } from "@/components/rack/readout";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtBps, fmtOffset, fmtRtt } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { LinkSummary } from "./types";

function stateLamp(summary: LinkSummary) {
  switch (summary.state) {
    case "connected":
      return { state: "ok" as const, label: "TRACKING" };
    case "connecting":
      return { state: "acquire" as const, label: "ACQUIRING" };
    case "reconnecting":
      return { state: "warn" as const, label: `RECONNECT ${summary.reconnect}` };
    case "exited":
      return { state: "off" as const, label: "EXITED" };
    case "fault":
      return { state: "bad" as const, label: "FAULT" };
  }
}

export function StatusStrip({ summary }: { summary: LinkSummary }) {
  const { t } = useI18n();
  const lamp = stateLamp(summary);
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-2 overflow-hidden border-t border-line bg-panel px-2 sm:gap-5 sm:px-3"
      aria-live="polite"
    >
      <Lamp state={lamp.state} label={lamp.label} className="w-20 sm:w-28" />
      <Readout
        label="ROLE"
        value={summary.role ? t(`session.role.${summary.role}`) : "—"}
        tone={summary.role === "controller" ? "accent" : "default"}
        className="hidden w-20 sm:block"
      />
      <Readout label="RTT" value={fmtRtt(summary.rtt ?? NaN)} className="w-14 sm:w-20" />
      <Readout
        label="THROUGHPUT"
        value={fmtBps(summary.throughput ?? 0)}
        className="hidden w-24 md:block"
      />
      <Readout label="OFFSET" value={fmtOffset(summary.offset)} className="hidden w-16 sm:block" />
      {summary.gapFrom !== null ? (
        <span
          className="silkscreen hidden text-warn sm:inline"
          title={t("session.gapDetail", { from: summary.gapFrom })}
        >
          GAP @ {fmtOffset(summary.gapFrom)}
        </span>
      ) : null}
      <div className="ml-auto shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-line bg-panel2 px-2 py-0.5">
              <ShieldCheck className="size-3.5 text-ok" />
              <span className="silkscreen text-ink2">
                TLS<span className="hidden sm:inline"> RELAY</span>
              </span>
              <span className="silkscreen text-warn">NOT E2EE</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("session.securityModeDetail")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
