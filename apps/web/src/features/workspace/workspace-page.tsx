import { useEffect, useState } from "react";

import { EmptyState } from "@/components/rack/empty-state";
import { Button } from "@/components/ui/button";
import { useRouter } from "@tanstack/react-router";
import { Plus, SquareTerminal } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/stores/workspace";
import { CommandPalette } from "./command-palette";
import { TabBar } from "./tab-bar";
import { TerminalTab } from "./terminal-tab";

/** Terminal workspace: tab strip + persistent pane trees for every open tab. */
export function WorkspacePage() {
  const { t } = useI18n();
  const router = useRouter();
  const tabs = useWorkspace((state) => state.tabs);
  const activeTabId = useWorkspace((state) => state.activeTab);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tabs.length > 0 ? <TabBar /> : null}
      <div className="relative min-h-0 flex-1 bg-bg">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`absolute inset-0 overflow-hidden ${
                active ? "" : "invisible pointer-events-none"
              }`}
              aria-hidden={!active}
              inert={!active}
            >
              <TerminalTab tab={tab} />
            </div>
          );
        })}
        {activeTab === null ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={<SquareTerminal />}
              title={t("session.empty")}
              hint={t("session.emptyHint")}
              className="w-full max-w-md"
              action={
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => useWorkspace.getState().addHomeTab()}>
                    {t("workspace.newTab")}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void router.navigate({ to: "/sessions", search: { create: 1 } })}
                  >
                    <Plus />
                    {t("session.create")}
                  </Button>
                </div>
              }
            />
          </div>
        ) : null}
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
