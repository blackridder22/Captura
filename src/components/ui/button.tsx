import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "surface" | "accent" | "danger";
  size?: "sm" | "md" | "icon";
};

export function Button({
  className,
  variant = "surface",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      className={cn("ui-button", className)}
      {...props}
    />
  );
}

