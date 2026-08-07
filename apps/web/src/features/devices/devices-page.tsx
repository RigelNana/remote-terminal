import { useRouter } from "@tanstack/react-router";
import { MoreHorizontal, Pencil, RefreshCw, Satellite, Trash2 } from "lucide-react";
import { useState } from "react";

import { Lamp } from "@/components/rack/lamp";
import { EmptyState } from "@/components/rack/empty-state";
import { ErrorState } from "@/components/rack/error-state";
import { PageHeader, PageShell } from "@/components/rack/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { errorKey } from "@/lib/errors";
import { fmtRelative, fmtTime } from "@/lib/format";
import { useDevices, useRenameDevice, useRevokeDevice } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import type { Device } from "@/lib/types";
import { useOpenSession } from "@/features/sessions/open-session";
import { toast } from "sonner";

const LAMP: Record<Device["state"], "ok" | "warn" | "off" | "bad"> = {
  online: "ok",
  degraded: "warn",
  offline: "off",
  revoked: "bad",
};

export function DevicesPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: devices, isLoading, error, refetch, isRefetching } = useDevices();
  const [rename, setRename] = useState<Device | null>(null);
  const [revoke, setRevoke] = useState<Device | null>(null);

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
        title={t("device.title")}
        subtitle={t("device.subtitle")}
        action={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("common.refresh")}
            onClick={() => void refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={isRefetching ? "animate-spin" : ""} />
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : devices && devices.length > 0 ? (
        <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-panel">
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              onRename={() => setRename(device)}
              onRevoke={() => setRevoke(device)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Satellite />}
          title={t("device.empty")}
          hint={t("device.emptyHint")}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void router.navigate({ to: "/sessions", search: { create: 1 } })}
            >
              {t("session.create")}
            </Button>
          }
        />
      )}

      {rename ? <RenameDialog device={rename} onClose={() => setRename(null)} /> : null}
      {revoke ? <RevokeDialog device={revoke} onClose={() => setRevoke(null)} /> : null}
    </PageShell>
  );
}

function DeviceRow({
  device,
  onRename,
  onRevoke,
}: {
  device: Device;
  onRename: () => void;
  onRevoke: () => void;
}) {
  const { t, locale } = useI18n();
  const openSession = useOpenSession();
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Lamp
        state={LAMP[device.state]}
        label={t(`device.state.${device.state}`)}
        className="w-24 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{device.name}</span>
          {device.state === "revoked" ? (
            <span className="silkscreen text-bad">{t("device.revokedTag")}</span>
          ) : null}
          <span className="readout shrink-0 text-[11px] text-ink3">
            {device.platform} · v{device.version}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {device.last_seen_at ? (
            <span className="readout text-[11px] text-ink3">
              {t("device.lastSeen")} {fmtRelative(device.last_seen_at, locale)} ·{" "}
              {fmtTime(device.last_seen_at, locale)}
            </span>
          ) : (
            <span className="readout text-[11px] text-ink3">{t("common.never")}</span>
          )}
          <span className="readout text-[11px] text-ink3" title={device.fingerprint}>
            {t("device.fingerprint")} {device.fingerprint.slice(0, 12)}…
          </span>
        </div>
        {device.profiles.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {device.profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                disabled={device.state !== "online"}
                className="rounded-full border border-line2 bg-panel2 px-2.5 py-0.5 text-xs text-ink2 transition-colors hover:border-accent/60 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                onClick={() => void openSession(device.id, profile.id).catch(() => undefined)}
              >
                {profile.name}
                <span className="ml-1 readout text-[10px] text-ink3">{profile.shell}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("common.actions")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            {t("common.rename")}
          </DropdownMenuItem>
          {device.state !== "revoked" ? (
            <DropdownMenuItem danger onSelect={onRevoke}>
              <Trash2 />
              {t("common.revoke")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function RenameDialog({ device, onClose }: { device: Device; onClose: () => void }) {
  const { t } = useI18n();
  const rename = useRenameDevice();
  const [name, setName] = useState(device.name);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await rename.mutateAsync({ id: device.id, name: name.trim() });
      onClose();
    } catch (error) {
      toast.error(t(errorKey(error instanceof ApiError ? error.code : "UNKNOWN") as never));
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader title={t("device.renameTitle")} />
        <form onSubmit={submit} className="mt-4 space-y-1.5">
          <Label htmlFor="rename">{t("common.rename")}</Label>
          <Input
            id="rename"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({ device, onClose }: { device: Device; onClose: () => void }) {
  const { t } = useI18n();
  const revoke = useRevokeDevice();
  const confirm = async () => {
    try {
      await revoke.mutateAsync(device.id);
      onClose();
    } catch (error) {
      toast.error(t(errorKey(error instanceof ApiError ? error.code : "UNKNOWN") as never));
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader title={t("device.revokeTitle")} description={t("device.revokeWarn")} />
        <div className="mt-3 rounded-[var(--radius-control)] border border-line bg-bg px-3 py-2">
          <p className="truncate text-[13px] text-ink">{device.name}</p>
          <p className="readout truncate text-[11px] text-ink3">{device.id}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={() => void confirm()}>
            {t("common.revoke")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
