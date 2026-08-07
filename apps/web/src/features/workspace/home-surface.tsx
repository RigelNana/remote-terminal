import { useRouter } from "@tanstack/react-router";
import { ArrowUpRight, Plus, Satellite } from "lucide-react";

import { Lamp } from "@/components/rack/lamp";
import { Readout } from "@/components/rack/readout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDevices, useSessions } from "@/lib/hooks";
import { fmtDuration, fmtRelative } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Device } from "@/lib/types";
import { useWorkspace } from "@/stores/workspace";
import { useOpenSession } from "@/features/sessions/open-session";

/** Workspace home pane: observatory status + one-click instrument start. */
export function HomeSurface() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: devices, isLoading: loadingDevices } = useDevices();
  const { data: sessions } = useSessions();
  const openSession = useOpenSession();
  const online = devices?.filter((device) => device.state === "online") ?? [];
  const running = sessions?.filter((session) => session.state === "running") ?? [];

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-bg">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
        <div>
          <p className="silkscreen text-ink3">OBSERVATORY</p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <Readout
              label="INSTRUMENTS"
              value={`${online.length}/${devices?.length ?? 0}`}
              tone={online.length > 0 ? "ok" : "default"}
            />
            <Readout
              label="OBSERVATIONS"
              value={String(running.length)}
              tone={running.length > 0 ? "accent" : "default"}
            />
            <Readout label="SESSION" value={t("session.securityModeTls")} />
          </div>
        </div>

        <section aria-labelledby="quick-start">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="quick-start" className="text-sm font-semibold text-ink">
              {t("device.title")}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/devices" })}>
              {t("nav.devices")}
              <ArrowUpRight />
            </Button>
          </div>
          {loadingDevices ? (
            <div className="space-y-2">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : devices && devices.length > 0 ? (
            <ul className="space-y-2">
              {online.map((device) => (
                <DeviceQuickStart
                  key={device.id}
                  device={device}
                  onProfile={(profile) => void openSession(device.id, profile)}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-[var(--radius-panel)] border border-dashed border-line2 px-4 py-6 text-[13px] text-ink3">
              {t("device.emptyHint")}
            </p>
          )}
        </section>

        <section aria-labelledby="recent">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="recent" className="text-sm font-semibold text-ink">
              {t("session.title")}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/sessions" })}>
              {t("session.reattach")}
              <ArrowUpRight />
            </Button>
          </div>
          {sessions && sessions.length > 0 ? (
            <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-panel">
              {sessions.slice(0, 5).map((session) => {
                const isRunning = session.state === "running";
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
                return (
                  <li key={session.id} className="flex items-center gap-3 px-3 py-2.5">
                    <Lamp state={lamp} label={label} className="w-24" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{session.profile}</p>
                      <p className="readout truncate text-[11px] text-ink3">
                        {session.cwd || "~"} · {fmtDuration(Date.now() / 1000 - session.started_at)}
                      </p>
                    </div>
                    {isRunning ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          useWorkspace.getState().addTerminalTab(session.id, session.profile);
                          void router.navigate({ to: "/workspace" });
                        }}
                      >
                        {t("session.open")}
                      </Button>
                    ) : (
                      <Badge variant="neutral">{t(`session.state.${session.state}`)}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-[var(--radius-panel)] border border-dashed border-line2 px-4 py-6 text-[13px] text-ink3">
              {t("session.emptyHint")}
            </p>
          )}
        </section>

        <button
          type="button"
          className="group flex items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-dashed border-line2 px-4 py-5 text-[13px] text-ink3 transition-colors hover:border-accent/50 hover:text-ink2"
          onClick={() => router.navigate({ to: "/sessions", search: { create: 1 } })}
        >
          <Plus className="size-4" />
          {t("session.create")}
        </button>
      </div>
    </div>
  );
}

function DeviceQuickStart({
  device,
  onProfile,
}: {
  device: Device;
  onProfile: (profile: string) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <li className="rounded-[var(--radius-panel)] border border-line bg-panel px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Satellite className="size-4 text-ink3" />
        <span className="truncate text-[13px] font-medium text-ink">{device.name}</span>
        <span className="readout text-[11px] text-ink3">
          {device.last_seen_at
            ? t("device.lastSeen") + " " + fmtRelative(device.last_seen_at, locale)
            : t("common.never")}
        </span>
      </div>
      {device.profiles.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {device.profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className="rounded-full border border-line2 bg-panel2 px-2.5 py-0.5 text-xs text-ink2 transition-colors hover:border-accent/60 hover:text-ink"
              onClick={() => onProfile(profile.id)}
            >
              {profile.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-ink3">{t("device.noProfiles")}</p>
      )}
    </li>
  );
}
