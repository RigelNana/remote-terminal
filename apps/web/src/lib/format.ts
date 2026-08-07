/** Instrument-register formatting: offsets, durations, RTT, throughput. */

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

export function fmtBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  let unit = 0;
  let v = value;
  while (v >= 1024 && unit < UNITS.length - 1) {
    v /= 1024;
    unit += 1;
  }
  const digits = v >= 100 || unit === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${UNITS[unit]}`;
}

/** Byte offset with compact suffix, for session registers (e.g. "1.2M"). */
export function fmtOffset(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function fmtRtt(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1) return "<1 ms";
  return `${Math.round(ms)} ms`;
}

export function fmtBps(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  const kibs = bytesPerSecond / 1024;
  if (kibs >= 1024) return `${(kibs / 1024).toFixed(1)} MiB/s`;
  return `${kibs.toFixed(0)} KiB/s`;
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function fmtTime(epochSeconds: number, locale: string): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function fmtRelative(epochSeconds: number, locale: string, now = Date.now() / 1000): string {
  const delta = now - epochSeconds;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(delta);
  if (abs < 60) return formatter.format(-Math.round(delta), "second");
  if (abs < 3600) return formatter.format(-Math.round(delta / 60), "minute");
  if (abs < 86400) return formatter.format(-Math.round(delta / 3600), "hour");
  return formatter.format(-Math.round(delta / 86400), "day");
}
