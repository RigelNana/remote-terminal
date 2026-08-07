import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import type { ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import type { AttachGrant } from "@/lib/types";
import { Attachment } from "./attachment";
import {
  applyTerminalModifiers,
  encodeTerminalKey,
  NO_TERMINAL_MODIFIERS,
  type TerminalKey,
  type TerminalModifiers,
} from "./terminal-keys";
import { terminalTheme } from "./theme";
import type { ExitInfo, FailureInfo, LinkState, LinkSummary, Role, TerminalEvents } from "./types";

const SUMMARY_MS = 250;
const MAX_WEBGL = 8;
const MAX_TITLE = 64;
const INITIAL_REPLAY_IDLE_MS = 120;
const INITIAL_REPLAY_MAX_MS = 2_000;

const activeRenderers = new Set<WebglAddon>();

const TEXT_ENCODER = new TextEncoder();

function stripControls(value: string): string {
  let clean = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code >= 32 && code !== 127) clean += character;
  }
  return clean;
}

export interface TerminalSettings {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  scrollback: number;
}

export interface TerminalOptions {
  session: string;
  reissue: (from: number) => Promise<AttachGrant>;
  from: number;
  settings: TerminalSettings;
  theme: "dark" | "light" | "hc";
  events: TerminalEvents;
}

export interface SearchControls {
  next: (query: string, options: ISearchOptions) => boolean;
  previous: (query: string, options: ISearchOptions) => boolean;
  clear: () => void;
  onResults: (callback: (current: number, total: number) => void) => () => void;
}

/**
 * Terminal deep module (PRD §10.2): React callers learn mount / attach /
 * focus / resize / detach / release and a state snapshot. Everything about
 * xterm parsing, addons, WebSocket offsets, ACKs and flow control stays here.
 * PTY output bytes flow directly from the wire into xterm.write; they never
 * touch React state.
 */
export class TerminalController {
  private readonly container: HTMLElement;
  private readonly term: Terminal;
  private readonly fitAddon: FitAddon;
  private readonly search: SearchAddon;
  private readonly attachment: Attachment;
  private readonly events: TerminalEvents;
  private readonly summaryTimer: ReturnType<typeof setInterval>;
  private resizeFrame: number | null = null;
  private observer: ResizeObserver | null = null;
  private disposed = false;

  private role: Role | null = null;
  private rtt: number | null = null;
  private throughput: number | null = null;
  private offset = 0;
  private state: LinkState = "connecting";
  private reconnect = 0;
  private gapFrom: number | null = null;
  private exit: ExitInfo | null = null;
  private failure: FailureInfo | null = null;
  private lastCols = 0;
  private lastRows = 0;
  private inputModifiers: TerminalModifiers = NO_TERMINAL_MODIFIERS;
  private onModifiersConsumed: (() => void) | null = null;
  private replayIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private replayMaxTimer: ReturnType<typeof setTimeout> | undefined;
  private replayPendingWrites = 0;
  private replaySawOutput = false;
  private replayDeadlineReached = false;
  private replayReady = false;

  private constructor(container: HTMLElement, options: TerminalOptions) {
    this.container = container;
    this.events = options.events;
    container.dataset.replay = "catching-up";
    container.setAttribute("aria-busy", "true");
    this.term = new Terminal({
      fontFamily: options.settings.fontFamily,
      fontSize: options.settings.fontSize,
      lineHeight: options.settings.lineHeight,
      scrollback: options.settings.scrollback,
      theme: terminalTheme(options.theme),
      allowProposedApi: true,
      cursorBlink: true,
      macOptionIsMeta: true,
      convertEol: false,
    });
    this.fitAddon = new FitAddon();
    this.search = new SearchAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.search);
    this.term.loadAddon(new Unicode11Addon());
    this.term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        if (/^https?:\/\//i.test(uri)) {
          window.open(uri, "_blank", "noopener");
        }
      }),
    );
    this.enableWebgl();
    this.term.open(container);
    this.fitAddon.fit();

    this.attachment = new Attachment(options.session, options.reissue, {
      onRole: (role) => {
        this.role = role;
        if (role === "controller") {
          this.lastCols = 0;
          this.lastRows = 0;
          this.fit();
        }
        this.emit();
      },
      onWrite: (bytes, ackEnd) => {
        this.offset = Math.max(this.offset, ackEnd);
        const initialReplay = !this.replayReady;
        if (initialReplay) {
          this.replaySawOutput = true;
          this.replayPendingWrites += 1;
          if (this.replayIdleTimer !== undefined) {
            clearTimeout(this.replayIdleTimer);
            this.replayIdleTimer = undefined;
          }
        }
        this.term.write(bytes, () => {
          this.attachment.consumed(ackEnd);
          if (!initialReplay || this.replayReady) return;
          this.replayPendingWrites = Math.max(0, this.replayPendingWrites - 1);
          if (this.replayPendingWrites > 0) return;
          if (this.replayDeadlineReached) {
            this.finishInitialReplay();
            return;
          }
          this.replayIdleTimer = setTimeout(
            () => this.finishInitialReplay(),
            INITIAL_REPLAY_IDLE_MS,
          );
        });
      },
      onGap: (availableStart) => {
        if (!this.replayReady) {
          this.replaySawOutput = true;
          if (this.replayIdleTimer !== undefined) {
            clearTimeout(this.replayIdleTimer);
            this.replayIdleTimer = undefined;
          }
        }
        this.gapFrom = availableStart;
        this.term.write("\r\n");
        this.term.writeln(
          `\x1b[33m[remote-terminal] output gap: journal starts at ${availableStart}; earlier history is gone\x1b[0m`,
        );
        this.emit();
      },
      onExit: (exit) => {
        this.exit = exit;
        this.state = "exited";
        this.term.writeln(
          `\r\n\x1b[2m[process exited: code ${exit.code ?? "—"}${exit.signal ? `, signal ${exit.signal}` : ""}]\x1b[0m`,
        );
        this.events.onExit(exit);
        this.emit();
      },
      onFailure: (failure) => {
        this.failure = failure;
        if (!failure.retryable || failure.code === "CONTROL_DENIED") {
          this.state = "fault";
        }
        this.emit();
      },
      onState: (state, attempt) => {
        this.state = state;
        this.reconnect = attempt;
        this.emit();
      },
      onRtt: (rtt) => {
        this.rtt = rtt;
      },
      onThroughput: (bps) => {
        this.throughput = bps;
      },
    });

    this.term.onData((data) => {
      if (this.role !== "controller") return;
      const input =
        this.inputModifiers.ctrl || this.inputModifiers.alt
          ? applyTerminalModifiers(data, this.takeInputModifiers())
          : data;
      this.attachment.sendInput(TEXT_ENCODER.encode(input));
    });
    this.term.onTitleChange((title) => {
      const clean = stripControls(title).slice(0, MAX_TITLE).trim();
      if (clean) this.events.onTitle(clean);
    });
    this.term.onBell(() => {
      this.events.onBell();
    });

    this.observer = new ResizeObserver(() => {
      if (this.resizeFrame !== null) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = null;
        this.fit();
      });
    });
    this.observer.observe(container);

    this.summaryTimer = setInterval(() => this.emit(), SUMMARY_MS);
    this.replayMaxTimer = setTimeout(() => {
      this.replayDeadlineReached = true;
      if (this.replayPendingWrites === 0) this.finishInitialReplay();
    }, INITIAL_REPLAY_MAX_MS);

    void this.attachment.start();
  }

  static mount(container: HTMLElement, options: TerminalOptions): TerminalController {
    return new TerminalController(container, options);
  }

  focus(): void {
    this.term.focus();
  }

  updateSettings(settings: TerminalSettings): void {
    const fontChanged = this.term.options.fontFamily !== settings.fontFamily;
    this.term.options.fontFamily = settings.fontFamily;
    this.term.options.fontSize = settings.fontSize;
    this.term.options.lineHeight = settings.lineHeight;
    this.term.options.scrollback = settings.scrollback;
    this.fit();
    if (fontChanged) {
      void document.fonts.ready.then(() => {
        if (!this.disposed) this.fit();
      });
    }
  }

  updateTheme(theme: "dark" | "light" | "hc"): void {
    this.term.options.theme = terminalTheme(theme);
  }

  fit(): void {
    if (this.container.clientWidth < 2 || this.container.clientHeight < 2) return;
    this.fitAddon.fit();
    this.fitPty();
  }

  activate(): void {
    this.fit();
    this.term.refresh(0, this.term.rows - 1);
    this.term.focus();
  }

  /** Screen-reader mode toggle (PRD UX-005). */
  setScreenReader(enabled: boolean): void {
    this.term.options.screenReaderMode = enabled;
  }

  setInputModifiers(modifiers: TerminalModifiers, onConsumed: () => void): void {
    this.inputModifiers = modifiers;
    this.onModifiersConsumed = modifiers.ctrl || modifiers.alt ? onConsumed : null;
  }

  inputKey(key: TerminalKey): void {
    const modifiers = this.takeInputModifiers();
    this.term.input(encodeTerminalKey(key, modifiers), false);
    this.term.focus();
  }

  searchControls(): SearchControls {
    return {
      next: (query, options) => this.search.findNext(query, options),
      previous: (query, options) => this.search.findPrevious(query, options),
      clear: () => this.search.clearDecorations(),
      onResults: (callback) => {
        const subscription = this.search.onDidChangeResults(({ resultIndex, resultCount }) => {
          callback(resultIndex < 0 ? 0 : resultIndex + 1, resultCount);
        });
        return () => subscription.dispose();
      },
    };
  }

  /** Programmatic paste (bypasses the guarded textarea path after review). */
  paste(text: string): void {
    if (this.role !== "controller") return;
    this.term.paste(text);
  }

  /** Selected text, empty when nothing is selected (PRD IO-004 copy). */
  getSelection(): string {
    return this.term.getSelection();
  }

  snapshot(): LinkSummary {
    return {
      state: this.state,
      role: this.role,
      rtt: this.rtt,
      throughput: this.throughput,
      offset: this.offset,
      reconnect: this.reconnect,
      gapFrom: this.gapFrom,
      exit: this.exit,
      failure: this.failure,
    };
  }

  release(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.observer?.disconnect();
    clearInterval(this.summaryTimer);
    clearTimeout(this.replayIdleTimer);
    clearTimeout(this.replayMaxTimer);
    this.attachment.stop();
    this.term.dispose();
  }

  private emit(): void {
    if (!this.disposed) this.events.onSummary(this.snapshot());
  }

  private finishInitialReplay(): void {
    if (this.disposed || this.replayReady || this.replayPendingWrites > 0) return;
    this.replayReady = true;
    clearTimeout(this.replayIdleTimer);
    clearTimeout(this.replayMaxTimer);
    this.replayIdleTimer = undefined;
    this.replayMaxTimer = undefined;
    if (this.replaySawOutput) this.term.clear();
    this.container.dataset.replay = "ready";
    this.container.setAttribute("aria-busy", "false");
    this.term.refresh(0, this.term.rows - 1);
  }

  private fitPty(): void {
    if (this.disposed) return;
    const { cols, rows } = this.term;
    if (cols === this.lastCols && rows === this.lastRows) return;
    this.lastCols = cols;
    this.lastRows = rows;
    if (this.role === "controller") {
      this.attachment.resize({
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
      });
    }
  }

  private takeInputModifiers(): TerminalModifiers {
    const modifiers = this.inputModifiers;
    this.inputModifiers = NO_TERMINAL_MODIFIERS;
    const onConsumed = this.onModifiersConsumed;
    this.onModifiersConsumed = null;
    onConsumed?.();
    return modifiers;
  }

  private enableWebgl(): void {
    if (activeRenderers.size >= MAX_WEBGL) {
      const oldest = activeRenderers.values().next().value as WebglAddon | undefined;
      if (oldest) {
        activeRenderers.delete(oldest);
        oldest.dispose();
      }
    }
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      activeRenderers.add(webgl);
      this.term.loadAddon(webgl);
    } catch {
      // WebGL unavailable — the default DOM renderer is the fallback.
    }
  }
}
