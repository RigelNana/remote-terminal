import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import type { ComponentType, PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/zh";
import type { TerminalKey, TerminalModifiers } from "./terminal-keys";

interface KeyDefinition {
  key: TerminalKey;
  label: string;
  accessibleLabel: MessageKey;
  icon?: ComponentType<{ className?: string }>;
}

const NAVIGATION_KEYS: KeyDefinition[] = [
  { key: "escape", label: "Esc", accessibleLabel: "terminal.keyEscape" },
  { key: "tab", label: "Tab", accessibleLabel: "terminal.keyTab" },
  { key: "home", label: "Home", accessibleLabel: "terminal.keyHome" },
  { key: "end", label: "End", accessibleLabel: "terminal.keyEnd" },
  { key: "pageUp", label: "PgUp", accessibleLabel: "terminal.keyPageUp" },
  { key: "pageDown", label: "PgDn", accessibleLabel: "terminal.keyPageDown" },
  { key: "arrowLeft", label: "Left", accessibleLabel: "terminal.keyArrowLeft", icon: ArrowLeft },
  { key: "arrowDown", label: "Down", accessibleLabel: "terminal.keyArrowDown", icon: ArrowDown },
  { key: "arrowUp", label: "Up", accessibleLabel: "terminal.keyArrowUp", icon: ArrowUp },
  {
    key: "arrowRight",
    label: "Right",
    accessibleLabel: "terminal.keyArrowRight",
    icon: ArrowRight,
  },
];

const FUNCTION_KEYS = [
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
] as const satisfies readonly TerminalKey[];

function keepTerminalFocus(event: PointerEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export function MobileKeyBar({
  modifiers,
  onToggleModifier,
  onKey,
}: {
  modifiers: TerminalModifiers;
  onToggleModifier: (modifier: keyof TerminalModifiers) => void;
  onKey: (key: TerminalKey) => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="shrink-0 border-t border-line bg-panel md:hidden"
      aria-label={t("terminal.mobileKeys")}
      data-mobile-key-bar
    >
      <div
        className="flex snap-x gap-1 overflow-x-auto overscroll-x-contain px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label={t("terminal.navigationKeys")}
      >
        <Button
          type="button"
          variant={modifiers.ctrl ? "primary" : "secondary"}
          className="h-11 min-w-14 snap-start px-3 font-mono text-xs"
          aria-pressed={modifiers.ctrl}
          onPointerDown={keepTerminalFocus}
          onClick={() => onToggleModifier("ctrl")}
        >
          Ctrl
        </Button>
        <Button
          type="button"
          variant={modifiers.alt ? "primary" : "secondary"}
          className="h-11 min-w-14 snap-start px-3 font-mono text-xs"
          aria-pressed={modifiers.alt}
          onPointerDown={keepTerminalFocus}
          onClick={() => onToggleModifier("alt")}
        >
          Alt
        </Button>
        {NAVIGATION_KEYS.map(({ key, label, accessibleLabel, icon: Icon }) => (
          <Button
            key={key}
            type="button"
            variant="secondary"
            className="h-11 min-w-12 snap-start px-2 font-mono text-[11px]"
            aria-label={t(accessibleLabel)}
            onPointerDown={keepTerminalFocus}
            onClick={() => onKey(key)}
          >
            {Icon ? <Icon aria-hidden="true" /> : label}
          </Button>
        ))}
      </div>
      <div
        className="flex snap-x gap-1 overflow-x-auto overscroll-x-contain border-t border-line/70 px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label={t("terminal.functionKeys")}
      >
        {FUNCTION_KEYS.map((key) => (
          <Button
            key={key}
            type="button"
            variant="secondary"
            className="h-11 min-w-12 snap-start px-2 font-mono text-[11px] uppercase"
            onPointerDown={keepTerminalFocus}
            onClick={() => onKey(key)}
          >
            {key}
          </Button>
        ))}
      </div>
    </div>
  );
}
