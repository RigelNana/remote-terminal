import { Switch as RadixSwitch } from "radix-ui";
import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export const Switch = forwardRef<
  React.ComponentRef<typeof RadixSwitch.Root>,
  React.ComponentPropsWithoutRef<typeof RadixSwitch.Root>
>(({ className, ...props }, ref) => (
  <RadixSwitch.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line2",
      "bg-panel3 transition-colors duration-150 outline-none",
      "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
      "focus-visible:outline-1 focus-visible:outline-accent",
      "disabled:cursor-not-allowed disabled:opacity-45",
      className,
    )}
    {...props}
  >
    <RadixSwitch.Thumb
      className={cn(
        "pointer-events-none block size-4 rounded-full bg-ink2 shadow-[var(--shadow-raised)]",
        "transition-transform duration-150",
        "data-[state=checked]:translate-x-4 data-[state=checked]:bg-[#06131f]",
        "data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </RadixSwitch.Root>
));
Switch.displayName = "Switch";
