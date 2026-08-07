import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { Activity, LogOut, Satellite, Settings, ShieldCheck, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Lamp } from "@/components/rack/lamp";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WorkspacePage } from "@/features/workspace/workspace-page";
import { useDevices, useLogout, useMe } from "@/lib/hooks";
import { fmtRelative } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/cn";

function useRelayHealth() {
  const [state, setState] = useState<"checking" | "ok" | "bad">("checking");
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const response = await fetch("/health/ready", {
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        });
        const body: unknown = response.ok ? await response.json() : null;
        const ready =
          typeof body === "object" && body !== null && "status" in body && body.status === "ready";
        if (alive) setState(ready ? "ok" : "bad");
      } catch {
        if (alive) setState("bad");
      }
    };
    void check();
    const timer = setInterval(() => void check(), 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return state;
}

const NAV = [
  { to: "/workspace" as const, label: "workspace.home" },
  { to: "/devices" as const, label: "nav.devices" },
  { to: "/sessions" as const, label: "nav.sessions" },
  { to: "/audit" as const, label: "nav.audit" },
  { to: "/settings" as const, label: "nav.settings" },
] as const;

/** Application shell: dome-link strip, instrument rail, routed content. */
export function Shell() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { data: me } = useMe();
  const { data: devices } = useDevices();
  const logout = useLogout();
  const workspaceActive = useRouterState({
    select: (state) => state.location.pathname === "/workspace",
  });
  const [workspaceMounted, setWorkspaceMounted] = useState(workspaceActive);
  useEffect(() => {
    if (workspaceActive) setWorkspaceMounted(true);
  }, [workspaceActive]);
  const relay = useRelayHealth();
  const online = devices?.filter((device) => device.state === "online") ?? [];

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <Link to="/devices" className="flex shrink-0 items-baseline gap-2 outline-none">
          <span className="silkscreen text-sm text-ink">REMOTE TERMINAL</span>
          <span className="silkscreen hidden text-ink3 sm:inline">OBSERVATORY</span>
        </Link>
        <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="primary">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/devices" }}
              className="rounded-[var(--radius-control)] px-2.5 py-1 text-[13px] text-ink3 transition-colors hover:bg-panel3 hover:text-ink [&.active]:text-ink"
              activeProps={{ className: "bg-panel3 text-ink" }}
            >
              {t(item.label)}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="hidden items-center gap-2 sm:inline-flex">
                <Lamp
                  state={relay === "ok" ? "ok" : relay === "bad" ? "bad" : "acquire"}
                  label={relay === "ok" ? "DOME LINK" : relay === "bad" ? "DOME FAULT" : "CHECKING"}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t(
                relay === "ok"
                  ? "relay.ready"
                  : relay === "bad"
                    ? "error.NETWORK"
                    : "relay.checking",
              )}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="hidden cursor-help items-center gap-1.5 rounded-full border border-line bg-panel2 px-2 py-0.5 xl:inline-flex">
                <ShieldCheck className="size-3.5 text-ok" />
                <span className="silkscreen text-ink2">TLS RELAY</span>
                <span className="silkscreen text-warn">NOT E2EE</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("session.securityModeDetail")}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="max-w-40">
                <span className="truncate">
                  {me?.user.display_name ?? me?.user.username ?? "…"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{me?.user.username}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void router.navigate({ to: "/settings" })}>
                <Settings />
                {t("nav.settings")}
              </DropdownMenuItem>
              <DropdownMenuItem
                danger
                onSelect={() => {
                  void logout.mutateAsync(undefined).then(() => {
                    toast.success(t("auth.logout"));
                    void router.navigate({ to: "/login" });
                  });
                }}
              >
                <LogOut />
                {t("auth.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel lg:flex">
          <div className="flex items-center gap-2 px-3 pb-1 pt-3">
            <Activity className="size-3.5 text-ink3" />
            <span className="silkscreen text-ink3">INSTRUMENTS</span>
            <span className="ml-auto readout text-[11px] text-ink3">
              {online.length}/{devices?.length ?? 0}
            </span>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 py-1" aria-label="devices">
            {devices && devices.length > 0 ? (
              <ul className="space-y-0.5">
                {devices.map((device) => (
                  <li key={device.id}>
                    <Link
                      to="/devices"
                      className={cn(
                        "flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5",
                        "transition-colors hover:bg-panel3",
                      )}
                    >
                      <Satellite
                        className={cn(
                          "size-3.5",
                          device.state === "online"
                            ? "text-ok"
                            : device.state === "degraded"
                              ? "text-warn"
                              : device.state === "revoked"
                                ? "text-bad"
                                : "text-ink3",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink2">
                        {device.name}
                      </span>
                      <span className="readout shrink-0 text-[10px] text-ink3">
                        {device.last_seen_at
                          ? fmtRelative(device.last_seen_at, locale, Date.now() / 1000)
                          : "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-2 text-xs text-ink3">{t("device.empty")}</p>
            )}
          </nav>
          <div className="border-t border-line px-3 py-2">
            <Link
              to="/pair"
              className="flex items-center gap-2 text-xs text-ink3 transition-colors hover:text-ink2"
            >
              <Wrench className="size-3.5" />
              {t("pair.title")}
            </Link>
          </div>
        </aside>
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "absolute inset-0 overflow-hidden",
              workspaceActive ? "invisible pointer-events-none" : "visible",
            )}
            aria-hidden={workspaceActive}
          >
            <Outlet />
          </div>
          {workspaceMounted || workspaceActive ? (
            <div
              className={cn(
                "absolute inset-0 overflow-hidden",
                workspaceActive ? "visible" : "invisible pointer-events-none",
              )}
              aria-hidden={!workspaceActive}
            >
              <WorkspacePage />
            </div>
          ) : null}
        </main>
      </div>
      <nav
        className="grid h-12 shrink-0 grid-cols-5 border-t border-line bg-panel lg:hidden"
        aria-label="primary-mobile"
      >
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === "/devices" }}
            className="flex items-center justify-center border-t-2 border-transparent px-1 text-[11px] text-ink3 outline-none transition-colors hover:bg-panel3 hover:text-ink [&.active]:border-accent [&.active]:bg-panel2 [&.active]:text-ink"
          >
            {t(item.label)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
