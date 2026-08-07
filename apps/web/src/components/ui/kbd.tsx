import { cn } from "@/lib/cn";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line2 bg-panel3 px-1.5",
        "font-mono text-[11px] leading-none text-ink2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
