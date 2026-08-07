import {
  Accessibility,
  Maximize,
  Minimize,
  Minus,
  MoreHorizontal,
  Plus,
  PanelRight,
  Rows2,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

import { Lamp, type LampState } from "@/components/rack/lamp";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStopSession } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { useConnection } from "@/stores/connection";
import { DEFAULT_PREFERENCES, clampFontSize, usePreferences } from "@/stores/preferences";
import { useWorkspace, type Pane, type Tab } from "@/stores/workspace";
import { TerminalView, type TerminalHandle } from "../terminal/view";
import { HomeSurface } from "./home-surface";

const LAMP_BY_STATE: Partial<Record<string, LampState>> = {
  connected: "ok",
  connecting: "acquire",
  reconnecting: "warn",
  exited: "off",
  fault: "bad",
};

const LABEL_BY_STATE: Record<string, string> = {
  connected: "TRACKING",
  connecting: "ACQUIRING",
  reconnecting: "RECONNECT",
  exited: "EXITED",
  fault: "FAULT",
};

export function PaneFrame({ tab, pane }: { tab: Tab; pane: Pane }) {
  const { t } = useI18n();
  const terminalRef = useRef<TerminalHandle>(null);
  const summary = useConnection((state) => state.summaries[pane.id]);
  const [screenReader, setScreenReader] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const stopSession = useStopSession();
  const workspace = useWorkspace();
  const fontSize = usePreferences((state) => state.preferences.fontSize);
  const setPreferences = usePreferences((state) => state.set);
  const workspaceActive = useRouterState({
    select: (state) => state.location.pathname === "/workspace",
  });
  const changeFontSize = (delta: number) => {
    setPreferences({ fontSize: clampFontSize(fontSize + delta) });
  };

  useEffect(() => {
    if (workspaceActive && workspace.activeTab === tab.id && tab.activePane === pane.id) {
      terminalRef.current?.activate();
    }
  }, [workspaceActive, workspace.activeTab, tab.id, tab.activePane, pane.id]);

  const isActive = tab.activePane === pane.id;
  const zoomed = tab.zoomed === pane.id;
  const lamp = summary ? (LAMP_BY_STATE[summary.state] ?? "off") : pane.session ? "acquire" : "off";
  const lampLabel = summary
    ? (LABEL_BY_STATE[summary.state] ?? "IDLE")
    : pane.session
      ? "BOOT"
      : "IDLE";
  const roleLabel = summary?.role ? t(`session.role.${summary.role}`) : null;

  const title = pane.session ? tab.title : t("workspace.home");

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-bg"
      data-pane={pane.id}
      onPointerDownCapture={() => {
        if (!isActive) workspace.setActivePane(tab.id, pane.id);
      }}
    >
      <div
        className={
          "flex h-8 shrink-0 items-center gap-2 border-b border-line px-2 " +
          (isActive ? "bg-panel" : "bg-panel/60")
        }
      >
        <Lamp state={lamp} label={lampLabel} className="w-24 shrink-0" />
        <span className="truncate text-xs font-medium text-ink2" title={title} aria-label={title}>
          {title}
        </span>
        {roleLabel ? <span className="silkscreen shrink-0 text-ink3">{roleLabel}</span> : null}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {pane.session ? (
            <div
              className="mr-1 flex items-center border-r border-line pr-1"
              role="group"
              aria-label={t("settings.fontSize")}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("terminal.fontDecrease")}
                    onClick={() => changeFontSize(-1)}
                  >
                    <Minus />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("terminal.fontDecrease")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="readout text-[10px]"
                    aria-label={t("terminal.fontReset")}
                    onClick={() => setPreferences({ fontSize: DEFAULT_PREFERENCES.fontSize })}
                  >
                    {fontSize}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("terminal.fontReset")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("terminal.fontIncrease")}
                    onClick={() => changeFontSize(1)}
                  >
                    <Plus />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("terminal.fontIncrease")}</TooltipContent>
              </Tooltip>
            </div>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("workspace.splitHorizontal")}
                onClick={() => workspace.splitPane(tab.id, pane.id, "row", pane.session)}
              >
                <PanelRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("workspace.splitHorizontal")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("workspace.splitVertical")}
                onClick={() => workspace.splitPane(tab.id, pane.id, "col", pane.session)}
              >
                <Rows2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("workspace.splitVertical")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={zoomed ? t("workspace.unzoom") : t("workspace.zoom")}
                onClick={() => workspace.setZoomed(tab.id, zoomed ? null : pane.id)}
              >
                {zoomed ? <Minimize /> : <Maximize />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{zoomed ? t("workspace.unzoom") : t("workspace.zoom")}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("common.actions")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {pane.session ? "SESSION" : t("workspace.home")}
              </DropdownMenuLabel>
              {pane.session ? (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      const next = !screenReader;
                      setScreenReader(next);
                      terminalRef.current?.setScreenReader(next);
                    }}
                  >
                    <Accessibility />
                    {t("terminal.screenReader")}
                    {screenReader ? " · ON" : ""}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConfirmStop(true)}>
                    <SquareTerminal />
                    {t("session.stop")}
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                danger
                onSelect={() => {
                  workspace.removePane(tab.id, pane.id);
                  useConnection.getState().clear(pane.id);
                }}
              >
                <X />
                {t("workspace.closePane")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {pane.session ? (
          <TerminalView
            key={pane.session}
            ref={terminalRef}
            paneId={pane.id}
            session={pane.session}
            onTitle={(nextTitle) => workspace.renameTab(tab.id, nextTitle)}
          />
        ) : (
          <HomeSurface />
        )}
      </div>

      {confirmStop ? (
        <ConfirmStopDialog
          onCancel={() => setConfirmStop(false)}
          onStop={(force) => {
            setConfirmStop(false);
            if (pane.session) {
              void stopSession.mutateAsync({ id: pane.session, force });
              if (force) workspace.removePane(tab.id, pane.id);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function ConfirmStopDialog({
  onCancel,
  onStop,
}: {
  onCancel: () => void;
  onStop: (force: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader title={t("session.stopTitle")} description={t("session.stopWarn")} />
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" onClick={() => onStop(false)}>
            {t("session.stop")}
          </Button>
          <Button variant="danger" onClick={() => onStop(true)}>
            {t("session.force")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
