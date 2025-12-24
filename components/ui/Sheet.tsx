"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "./Button";

export default function Sheet({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 safe-bottom"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
          >
            <div className="mx-auto w-full max-w-md rounded-t-[28px] border border-[var(--cardBorder)] bg-[var(--bg)] shadow-soft">
              <div className="flex items-center justify-between px-5 pt-5">
                <div className="text-base font-semibold">{title}</div>
                <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="px-5 pb-6 pt-3">{children}</div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
