import { zh as zhKeys } from "./i18n/zh";
import type { MessageKey } from "./i18n/zh";

/**
 * Stable error catalog — PRD §16. The frontend maps a backend code to a
 * message key plus a recovery action; it never renders "Something went wrong".
 */

export const ERROR_CODES = [
  "INVALID_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "EXPIRED",
  "AUTH_REQUIRED",
  "AUTH_EXPIRED",
  "AUTH_FORBIDDEN",
  "ORIGIN_REJECTED",
  "DEVICE_OFFLINE",
  "DEVICE_REVOKED",
  "DEVICE_BUSY",
  "AGENT_OUTDATED",
  "PROFILE_MISSING",
  "PROFILE_INVALID",
  "CWD_MISSING",
  "CWD_DENIED",
  "SESSION_MISSING",
  "SESSION_EXITED",
  "SESSION_LOST",
  "SESSION_LIMIT",
  "ATTACH_EXPIRED",
  "CONTROL_DENIED",
  "SLOW_CONSUMER",
  "OUTPUT_GAP",
  "PROTOCOL_MISMATCH",
  "FRAME_TOO_LARGE",
  "RATE_LIMITED",
  "STORE_UNAVAILABLE",
  "NETWORK",
  "WEBAUTHN",
  "CONFIG",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  code: string;
  retryable: boolean;
  detail: string;
}

/** Map a stable backend code to an i18n message key with a safe fallback. */
export function errorKey(code: string): MessageKey {
  const key = `error.${code}` as MessageKey;
  return key in zhKeys ? key : "error.UNKNOWN";
}

/** Codes the client must treat as fatal for a connection: no auto-retry. */
export const FATAL_CODES = new Set<string>([
  "AUTH_REQUIRED",
  "AUTH_EXPIRED",
  "AUTH_FORBIDDEN",
  "ORIGIN_REJECTED",
  "DEVICE_REVOKED",
  "ATTACH_EXPIRED",
  "CONTROL_DENIED",
  "PROTOCOL_MISMATCH",
  "FRAME_TOO_LARGE",
  "SESSION_MISSING",
  "SESSION_EXITED",
]);

export function isFatal(code: string): boolean {
  return FATAL_CODES.has(code);
}
