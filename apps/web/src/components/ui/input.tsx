import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "h-8.5 w-full rounded-[var(--radius-control)] border border-line bg-panel px-3 text-[13px] text-ink",
        "placeholder:text-ink3",
        "transition-colors duration-150",
        "focus-visible:border-accent focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
