import { useRouter } from "@tanstack/react-router";
import { Command } from "cmdk";
import {
  FolderKanban,
  ListOrdered,
  Monitor,
  Moon,
  Palette,
  Plus,
  ScrollText,
  Settings,
  Sun,
  TerminalSquare,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useI18n, LOCALES, type MessageKey } from "@/lib/i18n";
import { usePreferences, type Theme } from "@/stores/preferences";
import { useWorkspace } from "@/stores/workspace";

const THEMES: { value: Theme; icon: React.ReactNode }[] = [
  { value: "dark", icon: <Moon /> },
  { value: "light", icon: <Sun /> },
  { value: "hc", icon: <Monitor /> },
];

/** Global command palette (cmdk): navigation, sessions, theme, tabs. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, setLocale } = useI18n();
  const router = useRouter();
  const setPreferences = usePreferences((state) => state.set);
  const [query, setQuery] = useState("");

  const items = useMemo(
    () => [
      {
        id: "session",
        group: "SESSION",
        label: t("session.create"),
        icon: <Plus />,
        keywords: ["new", "shell", "terminal"],
        run: () => void router.navigate({ to: "/sessions", search: { create: 1 } }),
      },
      {
        id: "tab",
        group: "WORKSPACE",
        label: t("workspace.newTab"),
        icon: <TerminalSquare />,
        keywords: ["tab", "home"],
        run: () => {
          useWorkspace.getState().addHomeTab();
          void router.navigate({ to: "/workspace" });
        },
      },
      {
        id: "devices",
        group: "NAV",
        label: t("nav.devices"),
        icon: <FolderKanban />,
        keywords: ["instrument", "device"],
        run: () => void router.navigate({ to: "/devices" }),
      },
      {
        id: "sessions",
        group: "NAV",
        label: t("nav.sessions"),
        icon: <ListOrdered />,
        keywords: ["observation", "session"],
        run: () => void router.navigate({ to: "/sessions" }),
      },
      {
        id: "audit",
        group: "NAV",
        label: t("nav.audit"),
        icon: <ScrollText />,
        keywords: ["security", "log"],
        run: () => void router.navigate({ to: "/audit" }),
      },
      {
        id: "settings",
        group: "NAV",
        label: t("nav.settings"),
        icon: <Settings />,
        keywords: ["preferences", "options"],
        run: () => void router.navigate({ to: "/settings" }),
      },
      ...THEMES.map((theme) => ({
        id: `theme-${theme.value}`,
        group: "THEME",
        label: t(`settings.theme.${theme.value}` as MessageKey),
        icon: theme.icon,
        keywords: ["theme", "appearance"],
        run: () => setPreferences({ theme: theme.value }),
      })),
      ...LOCALES.map((item) => ({
        id: `locale-${item.value}`,
        group: "LANGUAGE",
        label: item.label,
        icon: <Palette />,
        keywords: ["language", "lang"],
        run: () => setLocale(item.value),
      })),
    ],
    [router, setPreferences, setLocale, t],
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("workspace.palette")}
      shouldFilter={false}
    >
      <div className="fixed left-1/2 top-[18vh] z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-dialog)] border border-line2 bg-panel2 shadow-[var(--shadow-pop)]">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={t("workspace.palette")}
          className="h-11 w-full border-b border-line bg-transparent px-4 text-sm text-ink outline-none placeholder:text-ink3"
        />
        <Command.List className="max-h-80 overflow-y-auto p-1.5">
          {query ? (
            <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink3">
              {t("search.noResults")}
            </Command.Empty>
          ) : null}
          {(["SESSION", "WORKSPACE", "NAV", "THEME", "LANGUAGE"] as const).map((group) => {
            const groupItems = items.filter(
              (item) =>
                item.group === group &&
                (!query ||
                  item.keywords.some((k) => k.includes(query.toLowerCase())) ||
                  item.label.toLowerCase().includes(query.toLowerCase())),
            );
            if (groupItems.length === 0) return null;
            return (
              <Command.Group
                key={group}
                heading={<span className="silkscreen px-2 py-1.5 text-ink3">{group}</span>}
              >
                {groupItems.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    onSelect={() => {
                      item.run();
                      onOpenChange(false);
                    }}
                    className="flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-[13px] text-ink outline-none data-[selected=true]:bg-accent/15 data-[selected=true]:text-ink [&_svg]:size-4 [&_svg]:text-ink3"
                  >
                    {item.icon}
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
        </Command.List>
        <div className="flex items-center gap-3 border-t border-line px-3 py-1.5">
          <span className="silkscreen text-ink3">CTRL K</span>
          <span className="silkscreen text-ink3">OBSERVATORY</span>
        </div>
      </div>
    </Command.Dialog>
  );
}
