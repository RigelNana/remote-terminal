import { cn } from "@/lib/cn";

/** Instrument-empty state: teaches the next action instead of saying "nothing here". */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-panel)]",
        "border border-dashed border-line2 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-line2 bg-panel2 text-ink3 [&_svg]:size-5">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {hint ? <p className="mx-auto max-w-sm text-[13px] leading-5 text-ink3">{hint}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
