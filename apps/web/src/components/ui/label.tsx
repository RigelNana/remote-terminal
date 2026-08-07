import { Label as RadixLabel } from "radix-ui";
import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export const Label = forwardRef<
  React.ComponentRef<typeof RadixLabel.Root>,
  React.ComponentPropsWithoutRef<typeof RadixLabel.Root>
>(({ className, ...props }, ref) => (
  <RadixLabel.Root
    ref={ref}
    className={cn("text-[13px] font-medium text-ink2", className)}
    {...props}
  />
));
Label.displayName = "Label";
