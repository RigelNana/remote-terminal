import { cn } from "@/lib/cn";

const TONES = {
  default: "text-ink",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  accent: "text-accent",
} as const;

/**
 * Instrument register: silkscreen micro-label over a tabular-mono value.
 * Real measurement only — offsets, RTT, durations, sizes.
 */
export function Readout({
  label,
  value,
  tone = "default",
  className,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="silkscreen truncate text-ink3">{label}</span>
      <span className={cn("readout truncate text-[13px] leading-4", TONES[tone], valueClassName)}>
        {value}
      </span>
    </div>
  );
}
