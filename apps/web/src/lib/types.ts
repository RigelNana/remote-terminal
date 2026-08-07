/** REST contract types — mirror crates/relay model and route payloads. */

export interface User {
  id: string;
  username: string;
  display_name: string;
}

export interface Profile {
  id: string;
  name: string;
  shell: string;
  cwd: string;
}

export type DeviceState = "online" | "degraded" | "offline" | "revoked";

export interface Device {
  id: string;
  name: string;
  platform: string;
  version: string;
  fingerprint: string;
  profiles: Profile[];
  state: DeviceState;
  created_at: number;
  last_seen_at: number | null;
}

export type SessionState = "starting" | "running" | "exited" | "lost";

export interface Session {
  id: string;
  device: string;
  profile: string;
  cwd: string;
  state: SessionState;
  pid: number | null;
  started_at: number;
  ended_at: number | null;
  exit_code: number | null;
  reason: string | null;
}

export interface Size {
  cols: number;
  rows: number;
  pixel_width: number;
  pixel_height: number;
}

export interface AttachGrant {
  attach: string;
  ticket: string;
  url: string;
}

export interface Started {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface Review {
  user_code: string;
  name: string;
  platform: string;
  version: string;
  fingerprint: string;
  expires_at: number;
}

export interface Registered {
  user: User;
  recovery_codes: string[];
}

export interface Me {
  user: User;
}

export interface CreateSession {
  device: string;
  profile: string;
  cwd?: string;
  size?: Size;
}

export interface AuditEvent {
  id: string;
  actor: string;
  kind: string;
  target: string;
  result: string;
  occurred_at: number;
}
