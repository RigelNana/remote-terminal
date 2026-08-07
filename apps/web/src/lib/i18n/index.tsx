import { createContext, use, useCallback, useMemo, useState } from "react";

import { en } from "./en";
import { zh } from "./zh";
import type { MessageKey } from "./zh";
export type { MessageKey } from "./zh";

export type Locale = "zh-CN" | "en";

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
];

const DICTS: Record<Locale, Record<MessageKey, string>> = {
  "zh-CN": zh,
  en,
};

type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  locale: initial,
  onLocaleChange,
  children,
}: {
  locale: Locale;
  onLocaleChange?: (locale: Locale) => void;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      onLocaleChange?.(next);
    },
    [onLocaleChange],
  );
  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => interpolate(DICTS[locale][key] ?? zh[key], vars),
    }),
    [locale, setLocale],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const ctx = use(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
