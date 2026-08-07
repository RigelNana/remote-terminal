import { useQuery } from "@tanstack/react-query";
import { Download, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/rack/empty-state";
import { ErrorState } from "@/components/rack/error-state";
import { PageHeader, PageShell } from "@/components/rack/page-shell";
import { VirtualList } from "@/components/rack/virtual-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { AuditEvent } from "@/lib/types";

const ROW_HEIGHT = 44;

function resultVariant(result: string): "ok" | "bad" | "neutral" | "warn" {
  if (result === "success") return "ok";
  if (result === "denied" || result === "failure") return "bad";
  if (result === "requested") return "warn";
  return "neutral";
}
function resultKey(result: string): MessageKey {
  switch (result) {
    case "success":
      return "audit.result.success";
    case "denied":
      return "audit.result.denied";
    case "requested":
      return "audit.result.requested";
    default:
      return "audit.result.failure";
  }
}

/**
 * Audit trail (PRD AUD-001..004). Content-minimal by contract: the backend
 * never includes terminal bytes; the UI never renders any.
 */
export function AuditPage() {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState("");
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api.get<AuditEvent[]>("/v1/audit?limit=200"),
    retry: false,
  });

  const events = useMemo(() => {
    if (!data) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return data;
    return data.filter((event) =>
      [event.kind, event.actor, event.target, event.result]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(needle)),
    );
  }, [data, filter]);

  if (error instanceof ApiError) {
    return (
      <PageShell>
        <ErrorState code={error.code} retryable={error.retryable} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  const exportJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `audit-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageShell>
      <PageHeader
        title={t("audit.title")}
        subtitle={t("audit.subtitle")}
        action={
          <div className="flex gap-2">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("common.search")}
              className="h-8 w-44"
              aria-label={t("common.search")}
            />
            <Button variant="secondary" onClick={exportJson} disabled={!data || data.length === 0}>
              <Download />
              {t("audit.export")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common.refresh")}
              onClick={() => void refetch()}
              disabled={isRefetching}
            >
              <RefreshIcon spinning={isRefetching} />
            </Button>
          </div>
        }
      />
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : events.length > 0 ? (
        <VirtualList
          items={events}
          height="min(65vh, 640px)"
          rowHeight={ROW_HEIGHT}
          renderRow={(event) => (
            <div
              key={event.id}
              className="flex h-11 items-center gap-3 border-b border-line px-4 last:border-b-0"
            >
              <Badge variant={resultVariant(event.result)} className="w-24 justify-center">
                {t(resultKey(event.result))}
              </Badge>
              <span className="readout w-44 shrink-0 truncate text-xs text-ink2" title={event.kind}>
                {event.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink2" title={event.target}>
                {event.target}
              </span>
              <span className="readout shrink-0 text-[11px] text-ink3">
                {event.actor} · {fmtTime(event.occurred_at, locale)}
              </span>
            </div>
          )}
          className="rounded-[var(--radius-panel)] border border-line bg-panel"
        />
      ) : (
        <EmptyState icon={<ScrollText />} title={t("audit.empty")} />
      )}
    </PageShell>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "size-4 animate-spin" : "size-4"}
      aria-hidden
    >
      <path d="M3 12a9 9 0 0 1 15.5-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
