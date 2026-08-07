import type { AttachGrant } from "@/lib/types";

export type LinkState = "connecting" | "connected" | "reconnecting" | "exited" | "fault";

export type Role = "controller" | "viewer";

export interface ExitInfo {
  code: number | null;
  signal: string;
  reason: string;
}

export interface FailureInfo {
  code: string;
  retryable: boolean;
  detail: string;
}

/**
 * Throttled connection summary for status strips and tab badges. Contains no
 * terminal bytes (PRD §10.2: connection summaries only).
 */
export interface LinkSummary {
  state: LinkState;
  role: Role | null;
  rtt: number | null;
  throughput: number | null;
  offset: number;
  reconnect: number;
  gapFrom: number | null;
  exit: ExitInfo | null;
  failure: FailureInfo | null;
}

export interface TerminalEvents {
  onSummary: (summary: LinkSummary) => void;
  onTitle: (title: string) => void;
  onBell: () => void;
  /** Session exited on the remote side. */
  onExit: (exit: ExitInfo) => void;
}

export interface AttachHandle {
  /** Re-issue a one-time attach ticket for this session. */
  reissue: () => Promise<AttachGrant>;
}
