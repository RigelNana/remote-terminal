import { Tabs as RadixTabs } from "radix-ui";
import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export const Tabs = RadixTabs.Root;
export const TabsList = RadixTabs.List;
export const TabsTrigger = RadixTabs.Trigger;
export const TabsContent = RadixTabs.Content;

export const SettingsTabsList = forwardRef<
  React.ComponentRef<typeof RadixTabs.List>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.List>
>(({ className, ...props }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 rounded-[var(--radius-panel)] border border-line bg-panel p-1",
      className,
    )}
    {...props}
  />
));
SettingsTabsList.displayName = "SettingsTabsList";

export const SettingsTabsTrigger = forwardRef<
  React.ComponentRef<typeof RadixTabs.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(({ className, ...props }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-[13px] font-medium",
      "text-ink3 outline-none transition-colors duration-150",
      "data-[state=active]:bg-panel3 data-[state=active]:text-ink",
      "hover:text-ink2 focus-visible:outline-1 focus-visible:outline-accent",
      className,
    )}
    {...props}
  />
));
SettingsTabsTrigger.displayName = "SettingsTabsTrigger";
