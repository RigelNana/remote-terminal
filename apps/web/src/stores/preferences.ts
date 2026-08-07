import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { Locale } from "@/lib/i18n";

export type Theme = "system" | "dark" | "light" | "hc";
export type TerminalFont = "jetbrains" | "fira-code" | "ibm-plex" | "system";

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 32;

export const TERMINAL_FONTS: ReadonlyArray<{ value: TerminalFont; label: string }> = [
  { value: "jetbrains", label: "JetBrains Mono" },
  { value: "fira-code", label: "Fira Code" },
  { value: "ibm-plex", label: "IBM Plex Mono" },
  { value: "system", label: "System monospace" },
];

const FONT_FAMILY: Record<TerminalFont, string> = {
  jetbrains: "'JetBrains Mono'",
  "fira-code": "'Fira Code'",
  "ibm-plex": "'IBM Plex Mono'",
  system: "ui-monospace",
};

export function clampFontSize(value: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
}

export function terminalFontFamily(font: TerminalFont): string {
  return `${FONT_FAMILY[font]}, 'Symbols Nerd Font Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
}

export interface Preferences {
  theme: Theme;
  locale: Locale;
  font: TerminalFont;
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  bellVisual: boolean;
  bellSound: boolean;
  pasteThreshold: number;
  pasteAlwaysPreview: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  locale: "zh-CN",
  font: "jetbrains",
  fontSize: 14,
  lineHeight: 1.25,
  scrollback: 10_000,
  bellVisual: true,
  bellSound: false,
  pasteThreshold: 200,
  pasteAlwaysPreview: true,
};

interface PreferencesStore {
  preferences: Preferences;
  set: (patch: Partial<Preferences>) => void;
}

export const usePreferences = create<PreferencesStore>()(
  persist(
    (set) => ({
      preferences: DEFAULT_PREFERENCES,
      set: (patch) => set((state) => ({ preferences: { ...state.preferences, ...patch } })),
    }),
    {
      name: "rt.preferences",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      merge: (persisted, current) => {
        const stored = persisted as Partial<PreferencesStore>;
        return {
          ...current,
          ...stored,
          preferences: {
            ...DEFAULT_PREFERENCES,
            ...stored.preferences,
          },
        };
      },
    },
  ),
);

/** Resolve system preference to a concrete theme id. */
export function resolveTheme(theme: Theme): "dark" | "light" | "hc" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
