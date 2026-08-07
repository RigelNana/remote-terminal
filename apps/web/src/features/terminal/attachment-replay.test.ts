/** @vitest-environment jsdom */
/** @vitest-environment-options { "url": "http://localhost/" } */

import { create } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { decodeFrame, encodeFrame } from "@/protocol/codec";
import { PongSchema } from "@/protocol/gen/terminal_pb";
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
    onWrite: vi.fn(),
    onReplayComplete: vi.fn(),
    onGap: vi.fn(),
    onExit: vi.fn(),
    onFailure: vi.fn(),
    onState: vi.fn(),
    onRtt: vi.fn(),
    onThroughput: vi.fn(),
  };
}

describe("Attachment replay boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  it("signals replay completion only after the Agent echoes the attach-ordered ping", async () => {
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

    const ping = decodeFrame(socket!.sent[0]!);
    expect(ping.body?.case).toBe("ping");
    const nonce = ping.body?.case === "ping" ? ping.body.value.nonce : 0n;
    expect(events.onReplayComplete).not.toHaveBeenCalled();

    socket!.receive(
      encodeFrame("session-a", {
        case: "pong",
        value: create(PongSchema, { nonce }),
      }),
    );

    expect(events.onReplayComplete).toHaveBeenCalledOnce();
    attachment.stop();
  });
});
