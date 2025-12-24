import clsx from "clsx";

export function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={clsx(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs",
        "bg-[var(--chip)] border border-[var(--cardBorder)]",
        className
      )}
    >
      {children}
    </div>
  );
}
