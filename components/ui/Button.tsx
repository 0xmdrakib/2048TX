import React from "react";
import clsx from "clsx";

export function Button({
  className,
  variant = "solid",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "ghost" | "outline";
  size?: "sm" | "md";
}) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center rounded-2xl font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "h-9 px-3 text-sm" : "h-11 px-4 text-sm",
        variant === "solid" && "bg-black text-white hover:bg-black/90",
        variant === "outline" &&
          "border border-[var(--cardBorder)] bg-transparent hover:bg-[var(--chip)]",
        variant === "ghost" && "bg-transparent hover:bg-[var(--chip)]",
        className
      )}
    />
  );
}
