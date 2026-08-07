import { useRouter, useSearch } from "@tanstack/react-router";
import { ListOrdered, MoreHorizontal, Play, Plus, Square } from "lucide-react";
import { useState } from "react";

import { Lamp } from "@/components/rack/lamp";
import { EmptyState } from "@/components/rack/empty-state";
import { ErrorState } from "@/components/rack/error-state";
import { PageHeader, PageShell } from "@/components/rack/page-shell";
import { VirtualList } from "@/components/rack/virtual-list";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api";
import { fmtDuration, fmtTime } from "@/lib/format";
import { useDevices, useSessions, useStopSession } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import type { Session } from "@/lib/types";
import { useWorkspace } from "@/stores/workspace";
import { CreateSessionDialog } from "./create-dialog";

const ROW_HEIGHT = 68;

export function SessionsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearch({ from: "/shell/sessions" });
  const { data: sessions, isLoading, error, refetch } = useSessions();
  const { data: devices } = useDevices();
  const [dialogOpen, setDialogOpen] = useState(Boolean(search.create));

  if (error instanceof ApiError) {
    return (
      <PageShell>
        <ErrorState code={error.code} retryable={error.retryable} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={t("session.title")}
        subtitle={t("session.subtitle")}
        action={
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            <Plus />
            {t("session.create")}
          </Button>
        }
      />
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : sessions && sessions.length > 0 ? (
        <VirtualList
          items={sessions}
          height="min(60vh, 560px)"
          rowHeight={ROW_HEIGHT}
          renderRow={(session) => (
            <SessionRow
              key={session.id}
              session={session}
              deviceName={
                devices?.find((device) => device.id === session.device)?.name ?? session.device
              }
            />
          )}
          className="rounded-[var(--radius-panel)] border border-line bg-panel"
        />
      ) : (
        <EmptyState
          icon={<ListOrdered />}
          title={t("session.empty")}
          hint={t("session.emptyHint")}
          action={
            <Button variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
              <Plus />
              {t("session.create")}
            </Button>
          }
        />
      )}
      <CreateSessionDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open && search.create) void router.navigate({ to: "/sessions" });
        }}
      />
    </PageShell>
  );
}

function SessionRow({ session, deviceName }: { session: Session; deviceName: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const stop = useStopSession();
  const [confirm, setConfirm] = useState(false);
  const lamp =
    session.state === "running"
      ? ("ok" as const)
      : session.state === "starting"
        ? ("acquire" as const)
        : session.state === "lost"
          ? ("warn" as const)
          : ("off" as const);
  const label = {
    running: "TRACKING",
    starting: "ACQUIRING",
    exited: "EXITED",
    lost: "LOST",
  }[session.state];
  const openSession = () => {
    useWorkspace.getState().addTerminalTab(session.id, session.profile);
    void router.navigate({ to: "/workspace" });
  };
  return (
    <div className="flex min-h-[92px] flex-wrap items-start gap-x-3 gap-y-2 border-b border-line px-3 py-3 last:border-b-0 sm:h-[68px] sm:min-h-0 sm:flex-nowrap sm:items-center sm:px-4 sm:py-0">
      <Lamp state={lamp} label={label} className="mt-0.5 w-20 shrink-0 sm:mt-0 sm:w-24" />
      <div className="min-w-0 flex-[1_1_230px] sm:flex-1">
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="truncate text-sm font-medium text-ink">{session.profile}</span>
          <span className="readout truncate text-[11px] text-ink3">
            {deviceName} · {session.cwd || "~"}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:mt-0.5">
          <span className="readout text-[11px] text-ink3">
            {fmtTime(session.started_at, locale)} ·{" "}
            {fmtDuration(Date.now() / 1000 - session.started_at)}
          </span>
          {session.pid ? (
            <span className="readout text-[11px] text-ink3">PID {session.pid}</span>
          ) : null}
          {session.state === "exited" ? (
            <span className="readout text-[11px] text-ink3">
              {session.exit_code !== null ? `exit ${session.exit_code}` : (session.reason ?? "")}
            </span>
          ) : null}
        </div>
      </div>
      {session.state === "running" || session.state === "lost" ? (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {session.state === "running" ? (
            <Button variant="secondary" size="sm" onClick={openSession}>
              <Play />
              {t("session.open")}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("common.actions")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {session.state === "running" ? (
                <DropdownMenuItem onSelect={openSession}>
                  <Play />
                  {t("session.reattach")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem danger onSelect={() => setConfirm(true)}>
                <Square />
                {t("session.stop")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      {confirm ? (
        <Dialog open onOpenChange={(isOpen) => !isOpen && setConfirm(false)}>
          <DialogContent>
            <DialogHeader title={t("session.stopTitle")} description={t("session.stopWarn")} />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirm(false);
                  void stop.mutateAsync({ id: session.id, force: false });
                }}
              >
                {t("session.stop")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirm(false);
                  void stop.mutateAsync({ id: session.id, force: true });
                }}
              >
                {t("session.force")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
