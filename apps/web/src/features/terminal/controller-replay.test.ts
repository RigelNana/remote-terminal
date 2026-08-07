/** @vitest-environment jsdom */
/** @vitest-environment-options { "url": "http://localhost/" } */
import "@/test/setup-local-storage";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

interface FakeAttachmentEvents {
  onSnapshot: (bytes: Uint8Array, end: number) => void;
  onWrite: (bytes: Uint8Array, end: number) => void;
}

const fakes = vi.hoisted(() => ({
  attachmentEvents: null as FakeAttachmentEvents | null,
  terminal: null as null | {
    reset: Mock;
    writes: Uint8Array[];
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext() {
      return false;
    }
    findPrevious() {
      return false;
    }
    clearDecorations() {}
    onDidChangeResults() {
      return { dispose() {} };
    }
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: vi.fn() }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: vi.fn() }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    reset = vi.fn();
    writes: Uint8Array[] = [];

    constructor(options: Record<string, unknown>) {
      this.options = options;
      fakes.terminal = this;
    }

    loadAddon() {}
    open() {}
    write(bytes: Uint8Array, callback: () => void) {
      this.writes.push(bytes);
      callback();
    }
    onData() {}
    onTitleChange() {}
    onBell() {}
    focus() {}
    refresh() {}
    dispose() {}
    input() {}
    paste() {}
    getSelection() {
      return "";
    }
  },
}));
vi.mock("./attachment", () => ({
  Attachment: class {
    constructor(_session: string, _reissue: unknown, events: FakeAttachmentEvents) {
      fakes.attachmentEvents = events;
    }
    async start() {}
    stop() {}
    consumed() {}
    sendInput() {}
    resize() {}
  },
}));

import { TerminalController } from "./controller";

describe("TerminalController current-screen snapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakes.attachmentEvents = null;
    fakes.terminal = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("reveals the Agent snapshot directly without replaying journal bytes", () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 390 },
      clientHeight: { value: 640 },
    });
    const controller = TerminalController.mount(host, {
      session: "session-a",
      reissue: vi.fn(),
      settings: { fontSize: 14, lineHeight: 1.2, fontFamily: "monospace", scrollback: 5000 },
      theme: "dark",
      events: {
        onSummary: vi.fn(),
        onTitle: vi.fn(),
        onBell: vi.fn(),
        onExit: vi.fn(),
      },
    });

    expect(host.dataset.replay).toBe("catching-up");
    const screen = new TextEncoder().encode("current prompt$ ");
    fakes.attachmentEvents?.onSnapshot(screen, 25);

    expect(fakes.terminal?.reset).toHaveBeenCalledOnce();
    expect(fakes.terminal?.writes).toEqual([screen]);
    expect(host.dataset.replay).toBe("ready");
    controller.release();
  });
});
