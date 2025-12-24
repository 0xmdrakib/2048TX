"use client";

import { AnimatePresence, motion } from "framer-motion";

export type ToastState = { message: string } | null;

export function Toast({ toast }: { toast: ToastState }) {
  return (
    <AnimatePresence>
      {toast ? (
        <motion.div
          className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-full border border-[var(--cardBorder)] bg-[var(--card)] px-4 py-2 text-center text-sm leading-tight shadow-soft backdrop-blur max-w-[92vw] break-words"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
        >
          {toast.message}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
