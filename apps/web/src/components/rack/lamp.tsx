import { cn } from "@/lib/cn";

export type LampState = "off" | "ok" | "warn" | "bad" | "acquire";

/**
 * Instrument status lamp. State is always paired with a text label so it is
 * readable without color; blinking and pulsing are reserved for attention
 * states (reconnecting, acquiring) and follow prefers-reduced-motion.
 */
export function Lamp({
  state,
  label,
  className,
}: {
  state: LampState;
  label: string;
  className?: string;
}) {
  const tone = {
    off: "bg-[var(--lamp-off)]",
    ok: "bg-ok",
    warn: "bg-warn lamp-blink",
    bad: "bg-bad",
    acquire: "bg-warn lamp-pulse",
  }[state];
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-2 text-xs text-ink2", className)}
      role="status"
      aria-label={label}
    >
      <span aria-hidden className={cn("lamp-dot", tone)} />
      <span className="truncate">{label}</span>
    </span>
  );
}
