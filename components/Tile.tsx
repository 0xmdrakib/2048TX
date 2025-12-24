"use client";

import { motion } from "framer-motion";
import { getTileStyle, type ThemeId } from "@/lib/themes";

export default function Tile({
  value,
  theme,
}: {
  value: number;
  theme: ThemeId;
}) {
  const style = getTileStyle(theme, value);
  const big = value >= 1024;

  return (
    <motion.div
      className={[
        "h-full w-full rounded-2xl flex items-center justify-center",
        "select-none font-extrabold tracking-tight",
      ].join(" ")}
      style={{
        background: style.bg,
        color: style.fg,
        border: style.border ? `1px solid ${style.border}` : undefined,
        boxShadow: style.glow,
      }}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
    >
      <span className={big ? "text-2xl" : "text-3xl"}>{value}</span>
    </motion.div>
  );
}
