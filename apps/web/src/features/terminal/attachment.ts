import { create } from "@bufbuild/protobuf";

import { ApiError } from "@/lib/api";
import { encodeFrame, decodeFrame, type Body } from "@/protocol/codec";
import { isFatal } from "@/lib/errors";
import type { AttachGrant } from "@/lib/types";
import {
  AckSchema,
  InputSchema,
  PingSchema,
  PongSchema,
  ResizeSchema,
  SizeSchema,
} from "@/protocol/gen/terminal_pb";
import type { ExitInfo, FailureInfo, Role } from "./types";

const PROTOCOL = "remote-terminal.v1";
const PING_MS = 5_000;
type SendBody = Extract<Body, { case: string }>;

export interface AttachmentEvents {
  onRole: (role: Role) => void;
  /** Bytes for this terminal; `ackEnd` is the stream offset to acknowledge. */
  onWrite: (bytes: Uint8Array, ackEnd: number) => void;
  onGap: (availableStart: number, requestedStart: number) => void;
  onExit: (exit: ExitInfo) => void;
  onFailure: (failure: FailureInfo) => void;
  onState: (state: "connecting" | "connected" | "reconnecting", attempt: number) => void;
  onRtt: (rtt: number) => void;
  onThroughput: (bytesPerSecond: number) => void;
}

/**
 * Attachment to a session data link (PRD §10.2 deep module): owns the
 * WebSocket, one-time ticket consumption, protobuf framing, ACK flow control,
 * keep-alive, and jittered reconnection. Fatal codes stop reconnecting.
 */
export class Attachment {
  private ws: WebSocket | null = null;
  private stopped = false;
  private grant: AttachGrant | null = null;
  private attachId = "";
  private sequence = 0;
  private ackOffset = 0;
  private role: Role | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private bytesThisSecond = 0;
  private lastThroughput = Date.now();
  private readonly session: string;
  private readonly reissue: (from: number) => Promise<AttachGrant>;
  private readonly events: AttachmentEvents;

  constructor(
    session: string,
    reissue: (from: number) => Promise<AttachGrant>,
    events: AttachmentEvents,
  ) {
    this.session = session;
    this.reissue = reissue;
    this.events = events;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close(1000, "client detach");
    }
  }

  sendInput(data: Uint8Array): void {
    if (this.role !== "controller") return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendFrame({
      case: "input",
      value: create(InputSchema, {
        attach: this.attachId,
        sequence: BigInt(++this.sequence),
        data,
      }),
    });
  }

  resize(size: { cols: number; rows: number; pixel_width: number; pixel_height: number }): void {
    if (this.role !== "controller") return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendFrame({
      case: "resize",
      value: create(ResizeSchema, {
        attach: this.attachId,
        size: create(SizeSchema, {
          cols: size.cols,
          rows: size.rows,
          pixelWidth: size.pixel_width,
          pixelHeight: size.pixel_height,
        }),
      }),
    });
  }

  /** Advance the acknowledged offset; call after xterm consumed the bytes. */
  consumed(ackEnd: number): void {
    if (ackEnd <= this.ackOffset) return;
    this.ackOffset = ackEnd;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendFrame({
      case: "ack",
      value: create(AckSchema, { attach: this.attachId, end: BigInt(ackEnd) }),
    });
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.events.onState(this.attempt === 0 ? "connecting" : "reconnecting", this.attempt);
    try {
      this.grant = await this.reissue(this.ackOffset);
    } catch (error) {
      if (error instanceof ApiError && !error.retryable) {
        this.events.onFailure({
          code: error.code,
          retryable: false,
          detail: error.detail,
        });
        this.stop();
        return;
      }
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;
    const url = new URL(this.grant.url);
    // Production serves the web app and relay on one origin; dev proxies /v1.
    const wsUrl = new URL(url.pathname, window.location.origin);
    wsUrl.search = url.search;
    wsUrl.searchParams.set("ticket", this.grant.ticket);
    if (wsUrl.protocol === "http:") wsUrl.protocol = "ws:";
    if (wsUrl.protocol === "https:") wsUrl.protocol = "wss:";
    this.attachId = this.grant.attach;
    try {
      const ws = new WebSocket(wsUrl.toString(), PROTOCOL);
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      ws.addEventListener("open", () => {
        this.attempt = 0;
        this.events.onState("connected", 0);
        this.startTimers();
      });
      ws.addEventListener("message", (event) => this.onMessage(event));
      ws.addEventListener("close", () => this.onClosed());
      ws.addEventListener("error", () => ws.close());
    } catch {
      this.scheduleReconnect();
    }
  }

  private onMessage(event: MessageEvent): void {
    const ws = this.ws;
    if (!ws) return;
    if (typeof event.data === "string") {
      ws.close(1002, "text frame not allowed");
      return;
    }
    const bytes = new Uint8Array(event.data as ArrayBuffer);
    let frame;
    try {
      frame = decodeFrame(bytes);
    } catch {
      ws.close(1002, "undecodable frame");
      return;
    }
    if (frame.session !== this.session) {
      ws.close(1002, "session mismatch");
      return;
    }
    const body = frame.body;
    if (!body) return;
    switch (body.case) {
      case "role": {
        this.role = body.value.control ? "controller" : "viewer";
        this.events.onRole(this.role);
        break;
      }
      case "output": {
        const output = body.value;
        if (output.target === "" || output.target === this.attachId) {
          const outputBytes = output.data as Uint8Array;
          const end = Number(output.end);
          this.bytesThisSecond += outputBytes.byteLength;
          this.events.onWrite(outputBytes, end);
        }
        break;
      }
      case "gap": {
        const availableStart = Number(body.value.availableStart);
        const requestedStart = Number(body.value.requestedStart);
        this.events.onGap(availableStart, requestedStart);
        // Gap resets our recovery baseline; the relay/agent window follows.
        this.ackOffset = Math.max(this.ackOffset, availableStart);
        break;
      }
      case "exit": {
        const exit = body.value;
        this.events.onExit({
          code: exit.code,
          signal: exit.signal,
          reason: exit.reason,
        });
        break;
      }
      case "failure": {
        const failure = {
          code: body.value.code,
          retryable: body.value.retryable,
          detail: body.value.detail,
        };
        this.events.onFailure(failure);
        if (isFatal(failure.code)) {
          this.stop();
        }
        break;
      }
      case "pong": {
        const nonce = body.value.nonce;
        if (nonce > 0) {
          this.events.onRtt(Math.max(0, Date.now() - Number(nonce)));
        }
        break;
      }
      case "ping": {
        // Echo relay heartbeats so the half-open detector stays quiet.
        this.sendFrame({
          case: "pong",
          value: create(PongSchema, { nonce: body.value.nonce }),
        });
        break;
      }
      default:
        break;
    }
  }

  private onClosed(): void {
    this.clearTimers();
    this.ws = null;
    if (this.stopped) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.attempt) + Math.random() * 500;
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private startTimers(): void {
    this.clearTimers();
    this.pingTimer = setInterval(() => {
      this.sendFrame({
        case: "ping",
        value: create(PingSchema, { nonce: BigInt(Date.now()) }),
      });
      const now = Date.now();
      if (now - this.lastThroughput >= 1000) {
        this.events.onThroughput((this.bytesThisSecond * 1000) / (now - this.lastThroughput));
        this.bytesThisSecond = 0;
        this.lastThroughput = now;
      }
    }, PING_MS);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  private sendFrame(body: SendBody): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const ws = this.ws;
    try {
      ws.send(encodeFrame(this.session, body));
    } catch {
      ws.close(1002, "frame too large");
    }
  }
}
