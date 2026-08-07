import { DropdownMenu as RadixMenu } from "radix-ui";
import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;
export const DropdownMenuSeparator = RadixMenu.Separator;

export const DropdownMenuContent = forwardRef<
  React.ComponentRef<typeof RadixMenu.Content>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <RadixMenu.Portal>
    <RadixMenu.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-44 overflow-hidden rounded-[var(--radius-panel)] border border-line2",
        "bg-panel3 p-1 shadow-[var(--shadow-pop)]",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150",
        className,
      )}
      {...props}
    />
  </RadixMenu.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = forwardRef<
  React.ComponentRef<typeof RadixMenu.Item>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Item> & { danger?: boolean }
>(({ className, danger, ...props }, ref) => (
  <RadixMenu.Item
    ref={ref}
    className={cn(
      "flex h-8 cursor-pointer select-none items-center gap-2 rounded-[var(--radius-control)]",
      "px-2.5 text-[13px] text-ink outline-none",
      "data-[highlighted]:bg-accent/12",
      danger && "text-bad data-[highlighted]:bg-bad/15",
      "[&_svg]:size-4 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuLabel = forwardRef<
  React.ComponentRef<typeof RadixMenu.Label>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Label>
>(({ className, ...props }, ref) => (
  <RadixMenu.Label
    ref={ref}
    className={cn("px-2.5 py-1.5 text-xs font-medium text-ink3", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";
