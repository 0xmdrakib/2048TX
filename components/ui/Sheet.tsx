import { useEffect, useState } from "react";
import { X } from "lucide-react";

export default function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [render, setRender] = useState(open);

  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  const onAnimEnd = () => {
    if (!open) setRender(false);
  };

  if (!render) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center sm:items-center ${
        open ? "animate-in fade-in duration-200" : "animate-out fade-out duration-200"
      }`}
      onAnimationEnd={onAnimEnd}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Negative margin (-mb-[40px]) and extra padding-bottom are used below to make 
        the sheet's background bleed completely to the absolute bottom of the screen.
        This fixes the 1px/10px gaps seen in mobile webviews or in-app browsers.
      */}
      <div
        className={`relative w-full max-w-md sm:rounded-2xl rounded-t-[28px] bg-[var(--bg)] px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom)+40px)] -mb-[40px] sm:mb-0 sm:pb-5 shadow-2xl ${
          open
            ? "animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300"
            : "animate-out slide-out-to-bottom-full sm:slide-out-to-bottom-0 sm:zoom-out-95 duration-200"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-bold tracking-tight">{title}</div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 opacity-70 hover:bg-[var(--muted)] hover:opacity-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
