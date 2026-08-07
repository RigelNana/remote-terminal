import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { api } from "@/lib/api";
import { useConnection } from "@/stores/connection";
import {
  DEFAULT_PREFERENCES,
  clampFontSize,
  resolveTheme,
  terminalFontFamily,
  usePreferences,
} from "@/stores/preferences";
import { TerminalController, type SearchControls } from "./controller";
import { MobileKeyBar } from "./mobile-key-bar";
import { PasteGuard, type PasteRisk } from "./paste-guard";
import { SearchBar } from "./search-bar";
import { StatusStrip } from "./status-strip";
import { NO_TERMINAL_MODIFIERS, type TerminalKey, type TerminalModifiers } from "./terminal-keys";
import type { LinkSummary } from "./types";

export interface TerminalHandle {
  activate: () => void;
  setScreenReader: (enabled: boolean) => void;
}

const INITIAL_SUMMARY: LinkSummary = {
  state: "connecting",
  role: null,
  rtt: null,
  throughput: null,
  offset: 0,
  reconnect: 0,
  gapFrom: null,
  exit: null,
  failure: null,
};
function hasUnsafeControl(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function pasteRisk(text: string): PasteRisk {
  return {
    text,
    lines: text.split("\n").length,
    chars: text.length,
    control: hasUnsafeControl(text),
  };
}

let audio: AudioContext | null = null;
function beep(): void {
  if (!audio) return;
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 880;
  oscillator.connect(gain);
  gain.connect(audio.destination);
  gain.gain.setValueAtTime(0.025, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  oscillator.start(now);
  oscillator.stop(now + 0.1);
}

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView(
  { session, paneId, onTitle },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<TerminalController | null>(null);
  const paneIdRef = useRef(paneId);
  const onTitleRef = useRef(onTitle);
  paneIdRef.current = paneId;
  onTitleRef.current = onTitle;
  const searchRef = useRef<SearchControls | null>(null);
  const allowPasteRef = useRef(false);
  const preferences = usePreferences((state) => state.preferences);
  const prefsRef = useRef(preferences);
  prefsRef.current = preferences;
  const [summary, setSummary] = useState<LinkSummary>(
    () => useConnection.getState().summaries[paneId] ?? INITIAL_SUMMARY,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingPaste, setPendingPaste] = useState<PasteRisk | null>(null);
  const [exited, setExited] = useState<{ code: number | null; signal: string } | null>(null);
  const [modifiers, setModifiers] = useState<TerminalModifiers>(NO_TERMINAL_MODIFIERS);
  const clearModifiers = useCallback(() => setModifiers(NO_TERMINAL_MODIFIERS), []);
  const toggleModifier = (modifier: keyof TerminalModifiers) => {
    const next = { ...modifiers, [modifier]: !modifiers[modifier] };
    setModifiers(next);
    controllerRef.current?.setInputModifiers(next, clearModifiers);
  };
  const inputKey = (key: TerminalKey) => controllerRef.current?.inputKey(key);

  useImperativeHandle(
    ref,
    () => ({
      activate: () => controllerRef.current?.activate(),
      setScreenReader: (enabled) => controllerRef.current?.setScreenReader(enabled),
    }),
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const controller = TerminalController.mount(host, {
      session,
      from: 0,
      reissue: async (from) => api.post(`/v1/sessions/${session}/attach`, { from }),
      settings: {
        fontSize: prefsRef.current.fontSize,
        fontFamily: terminalFontFamily(prefsRef.current.font),
        lineHeight: prefsRef.current.lineHeight,
        scrollback: prefsRef.current.scrollback,
      },
      theme: resolveTheme(prefsRef.current.theme),
      events: {
        onSummary: (s) => {
          setSummary(s);
          useConnection.getState().setSummary(paneIdRef.current, s);
        },
        onTitle: (title) => onTitleRef.current(title),
        onBell: () => {
          if (prefsRef.current.bellVisual) flash(host);
          if (prefsRef.current.bellSound) beep();
        },
        onExit: (exit) => setExited({ code: exit.code, signal: exit.signal }),
      },
    });
    controllerRef.current = controller;
    searchRef.current = controller.searchControls();
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      event.preventDefault();
      if (allowPasteRef.current) {
        controller.paste(text);
        return;
      }
      const risk = pasteRisk(text);
      if (risk.lines > 1 || risk.chars > prefsRef.current.pasteThreshold || risk.control) {
        setPendingPaste(risk);
      } else {
        controller.paste(text);
      }
    };
    textarea?.addEventListener("paste", onPaste);
    return () => {
      textarea?.removeEventListener("paste", onPaste);
      controller.release();
      controllerRef.current = null;
    };
  }, [session]);

  // Live preference and theme changes.
  useEffect(() => {
    controllerRef.current?.updateSettings({
      fontFamily: terminalFontFamily(preferences.font),
      fontSize: preferences.fontSize,
      lineHeight: preferences.lineHeight,
      scrollback: preferences.scrollback,
    });
  }, [preferences.font, preferences.fontSize, preferences.lineHeight, preferences.scrollback]);
  useEffect(() => {
    controllerRef.current?.updateTheme(resolveTheme(preferences.theme));
  }, [preferences.theme]);

  // Search + copy keyboard (Ctrl/Cmd+F search, Ctrl/Cmd+C copies a selection
  // instead of sending SIGINT, PRD IO-004).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        usePreferences.getState().set({ fontSize: clampFontSize(prefsRef.current.fontSize + 1) });
        return;
      }
      if (mod && event.key === "-") {
        event.preventDefault();
        usePreferences.getState().set({ fontSize: clampFontSize(prefsRef.current.fontSize - 1) });
        return;
      }
      if (mod && event.key === "0") {
        event.preventDefault();
        usePreferences.getState().set({ fontSize: DEFAULT_PREFERENCES.fontSize });
        return;
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }
      if (mod && event.key.toLowerCase() === "c") {
        const controller = controllerRef.current;
        if (controller && hasSelection(hostRef.current)) {
          event.preventDefault();
          void navigator.clipboard.writeText(controller.getSelection());
        }
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-bg">
      {searchOpen ? (
        <SearchBar
          controls={searchRef.current ?? emptySearch}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0 overflow-hidden" data-terminal-host />
        {exited ? (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-line2 bg-panel3 px-3 py-1.5 text-xs text-ink2 shadow-[var(--shadow-raised)]">
            {exited.signal ? `${exited.signal}` : ""}{" "}
            {exited.code !== null ? `· ${exited.code}` : ""}
          </div>
        ) : null}
      </div>
      <MobileKeyBar modifiers={modifiers} onToggleModifier={toggleModifier} onKey={inputKey} />
      <StatusStrip summary={summary} />
      {pendingPaste ? (
        <PasteGuard
          risk={pendingPaste}
          onConfirm={(allowSession) => {
            if (allowSession) allowPasteRef.current = true;
            controllerRef.current?.paste(pendingPaste.text);
            setPendingPaste(null);
          }}
          onDeny={() => setPendingPaste(null)}
        />
      ) : null}
    </div>
  );
});

export interface TerminalViewProps {
  session: string;
  paneId: string;
  onTitle: (title: string) => void;
}

const emptySearch: SearchControls = {
  next: () => false,
  previous: () => false,
  clear: () => undefined,
  onResults: () => () => undefined,
};

function hasSelection(host: HTMLElement | null): boolean {
  const textarea = host?.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) return false;
  return textarea.selectionStart !== textarea.selectionEnd;
}

function flash(host: HTMLElement): void {
  host.classList.remove("rt-bell");
  void host.offsetWidth;
  host.classList.add("rt-bell");
  window.setTimeout(() => host.classList.remove("rt-bell"), 300);
}
