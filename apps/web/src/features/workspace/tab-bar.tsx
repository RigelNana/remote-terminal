import { Home, Plus, SquareTerminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { useConnection } from "@/stores/connection";
import { isSplit, useWorkspace, type Node, type Tab } from "@/stores/workspace";
import { cn } from "@/lib/cn";

export function TabBar() {
  const { t } = useI18n();
  const tabs = useWorkspace((state) => state.tabs);
  const activeTab = useWorkspace((state) => state.activeTab);
  const workspace = useWorkspace();

  return (
    <div
      className="flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-line bg-panel px-1.5"
      role="tablist"
      aria-label={t("nav.terminal")}
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeTab}
          onActivate={() => workspace.setActiveTab(tab.id)}
          onClose={() => closeTab(tab)}
          onRename={(title) => workspace.renameTab(tab.id, title)}
        />
      ))}
      <div className="ml-auto flex items-center gap-0.5 pl-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("workspace.newTab")}
              onClick={() => workspace.addHomeTab()}
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("workspace.newTab")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
function clearNodeSummary(node: Node): void {
  if (!isSplit(node)) {
    useConnection.getState().clear(node.id);
    return;
  }
  for (const child of node.items) clearNodeSummary(child);
}

function closeTab(tab: Tab): void {
  // Closing a tab detaches its views; the session keeps running (PRD SES-004).
  clearPaneSummaries(tab);
  useWorkspace.getState().removeTab(tab.id);
}

function clearPaneSummaries(tab: Tab): void {
  clearNodeSummary(tab.tree);
}

function TabItem({
  tab,
  active,
  onActivate,
  onClose,
  onRename,
}: {
  tab: Tab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const summaries = useConnection((state) => state.summaries);
  const firstSessionPane = findFirstSessionPane(tab.tree);
  const isHome = !firstSessionPane;
  const summary = firstSessionPane ? summaries[firstSessionPane.id] : undefined;
  const lamp = summary
    ? summary.state === "connected"
      ? "bg-ok"
      : summary.state === "reconnecting" || summary.state === "connecting"
        ? "bg-warn"
        : summary.state === "fault"
          ? "bg-bad"
          : "bg-[var(--lamp-off)]"
    : "bg-[var(--lamp-off)]";
  const hasUnread = summary?.state === "reconnecting" || summary?.state === "connecting";

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter") onActivate();
      }}
      className={cn(
        "group relative flex max-w-56 min-w-0 cursor-pointer select-none items-center gap-2",
        "border-b-2 px-2.5 text-xs transition-colors duration-150",
        active
          ? "border-accent bg-panel2 text-ink"
          : "border-transparent text-ink3 hover:bg-panel2/60 hover:text-ink2",
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", lamp, hasUnread && "lamp-blink")}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft.trim()) onRename(draft.trim());
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setEditing(false);
              if (draft.trim()) onRename(draft.trim());
            }
            if (event.key === "Escape") {
              setEditing(false);
              setDraft(tab.title);
            }
            event.stopPropagation();
          }}
          className="h-6 w-32 bg-bg px-1 text-xs text-ink outline-none"
          aria-label={t("common.rename")}
        />
      ) : (
        <button
          type="button"
          className="truncate"
          onDoubleClick={() => {
            setDraft(tab.title);
            setEditing(true);
          }}
          title={`${tab.title} — ${t("common.rename")}`}
        >
          {isHome && tab.title === "workspace.home" ? t("workspace.home") : tab.title}
          {firstSessionPane ? (
            <SquareTerminal className="ml-1 inline size-3 text-ink3" />
          ) : (
            <Home className="ml-1 inline size-3 text-ink3" />
          )}
        </button>
      )}
      <button
        type="button"
        aria-label={t("workspace.closeTab")}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="ml-auto rounded p-0.5 text-ink3 opacity-0 transition-opacity hover:bg-panel3 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function findFirstSessionPane(node: unknown): { id: string } | null {
  if (node && typeof node === "object" && "id" in node && "session" in node) {
    return (node as { id: string; session: string | null }).session
      ? (node as { id: string })
      : null;
  }
  if (node && typeof node === "object" && "items" in node) {
    for (const child of (node as { items: unknown[] }).items) {
      const found = findFirstSessionPane(child);
      if (found) return found;
    }
  }
  return null;
}
