import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] text-[13px] font-medium transition-colors duration-150 outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-[#06131f] hover:bg-accent2",
        secondary: "border border-line bg-panel2 text-ink hover:border-line2 hover:bg-panel3",
        ghost: "text-ink2 hover:bg-panel3 hover:text-ink",
        danger: "border border-bad/50 bg-bad/10 text-bad hover:bg-bad/20",
        outline: "border border-line2 text-ink hover:bg-panel3",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        default: "h-8.5 px-3.5",
        lg: "h-10 px-5 text-sm",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";
