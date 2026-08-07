import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import { EnvelopeSchema } from "./gen/terminal_pb";
import type { Envelope } from "./gen/terminal_pb";

export const WIRE_VERSION = 1;
export const MAX_FRAME = 256 * 1024;

export type Body = Envelope["body"];

export class ProtocolError extends Error {
  readonly code: "FRAME_TOO_LARGE" | "PROTOCOL_MISMATCH" | "EMPTY_FRAME";

  constructor(code: "FRAME_TOO_LARGE" | "PROTOCOL_MISMATCH" | "EMPTY_FRAME", message?: string) {
    super(message ?? code);
    this.name = "ProtocolError";
    this.code = code;
  }
}

/** Mirror of crates/proto wire::Envelope::encode_frame. */
export function encodeFrame(session: string, body: NonNullable<Body>): Uint8Array {
  const frame = create(EnvelopeSchema, { version: WIRE_VERSION, session, body });
  const bytes = toBinary(EnvelopeSchema, frame);
  if (bytes.byteLength > MAX_FRAME) {
    throw new ProtocolError("FRAME_TOO_LARGE");
  }
  return bytes;
}

/** Mirror of crates/proto wire::Envelope::decode_frame. */
export function decodeFrame(bytes: Uint8Array): Envelope {
  if (bytes.byteLength > MAX_FRAME) {
    throw new ProtocolError("FRAME_TOO_LARGE");
  }
  const frame = fromBinary(EnvelopeSchema, bytes);
  if (frame.version !== WIRE_VERSION) {
    throw new ProtocolError("PROTOCOL_MISMATCH");
  }
  if (frame.body?.case === undefined) {
    throw new ProtocolError("EMPTY_FRAME");
  }
  return frame;
}
