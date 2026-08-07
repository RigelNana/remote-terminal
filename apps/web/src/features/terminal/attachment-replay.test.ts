/** @vitest-environment jsdom */
/** @vitest-environment-options { "url": "http://localhost/" } */

import { create } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeFrame } from "@/protocol/codec";
import { OutputSchema, SnapshotSchema } from "@/protocol/gen/terminal_pb";
import { Attachment, type AttachmentEvents } from "./attachment";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "";
  readonly sent: Uint8Array[] = [];
  private readonly listeners = new Map<string, Array<(event: MessageEvent | Event) => void>>();

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent | Event) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    for (const listener of this.listeners.get("open") ?? []) listener(new Event("open"));
  }

  receive(data: Uint8Array) {
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    for (const listener of this.listeners.get("message") ?? []) {
      listener(new MessageEvent("message", { data: buffer }));
    }
  }
}

function attachmentEvents(): AttachmentEvents {
  return {
    onRole: vi.fn(),
    onSnapshot: vi.fn(),
    onWrite: vi.fn(),
    onGap: vi.fn(),
    onExit: vi.fn(),
    onFailure: vi.fn(),
    onState: vi.fn(),
    onRtt: vi.fn(),
    onThroughput: vi.fn(),
  };
}

describe("Attachment current-screen synchronization", () => {
  beforeEach(() => {
    vi.useRealTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  it("drops output before the snapshot and forwards only bytes after its offset", async () => {
    const events = attachmentEvents();
    const attachment = new Attachment(
      "session-a",
      async () => ({
        attach: "attach-a",
        ticket: "ticket-a",
        url: "http://localhost/v1/sessions/session-a/attach",
      }),
      events,
    );

    await attachment.start();
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket!.open();

    socket!.receive(
      encodeFrame("session-a", {
        case: "output",
        value: create(OutputSchema, {
          start: 0n,
          end: 10_000n,
          data: new TextEncoder().encode("old journal"),
        }),
      }),
    );
    expect(events.onWrite).not.toHaveBeenCalled();

    const screen = new TextEncoder().encode("current screen");
    socket!.receive(
      encodeFrame("session-a", {
        case: "snapshot",
        value: create(SnapshotSchema, {
          target: "attach-a",
          end: 10_000n,
          data: screen,
        }),
      }),
    );
    expect(events.onSnapshot).toHaveBeenCalledOnce();
    const [snapshotBytes, snapshotEnd] = vi.mocked(events.onSnapshot).mock.calls[0]!;
    expect(Array.from(snapshotBytes)).toEqual(Array.from(screen));
    expect(snapshotEnd).toBe(10_000);

    const live = new TextEncoder().encode("live");
    socket!.receive(
      encodeFrame("session-a", {
        case: "output",
        value: create(OutputSchema, {
          start: 10_000n,
          end: 10_004n,
          data: live,
        }),
      }),
    );
    expect(events.onWrite).toHaveBeenCalledOnce();
    const [liveBytes, liveEnd] = vi.mocked(events.onWrite).mock.calls[0]!;
    expect(Array.from(liveBytes)).toEqual(Array.from(live));
    expect(liveEnd).toBe(10_004);
    attachment.stop();
  });
});
