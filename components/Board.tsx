"use client";
import { AnimatePresence, motion, LayoutGroup } from "framer-motion";
import type { Board as BoardT } from "@/lib/engine2048";
import { boardToCells } from "@/lib/engine2048";
import type { ThemeId } from "@/lib/themes";
import Tile from "./Tile";

export default function Board({
  board,
  theme,
  isLocked,
}: {
  board: BoardT;
  theme: ThemeId;
  isLocked?: boolean;
}) {
  const cells = boardToCells(board);
  const size = board.length;
  const colsClass =
    {
      3: "grid-cols-3",
      4: "grid-cols-4",
      5: "grid-cols-5",
    }[size] || "grid-cols-4";

  return (
    <div
      className={[
        "relative w-full max-w-md aspect-square rounded-[28px] p-3 isolate touch-none",
        "bg-[var(--board)] border border-[var(--cardBorder)] shadow-soft",
        isLocked ? "opacity-90" : "",
      ].join(" ")}
      style={{
        // GPU layer — prevents repaint flicker in in-app browsers
        transform: "translateZ(0)",
        willChange: "transform",
        contain: "layout paint",
        WebkitBackfaceVisibility: "hidden",
        backfaceVisibility: "hidden",
      }}
    >
      <LayoutGroup id={`board-${size}`}>
        <div className={`grid h-full w-full gap-3 ${colsClass}`}>
          {cells.map(({ posKey, tile }) => (
            <div
              key={posKey}
              className="relative rounded-2xl bg-[var(--cell)]"
              style={{ transform: "translateZ(0)" }}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {tile ? (
                  <motion.div
                    key={tile.id}
                    layoutId={tile.id}
                    transition={{
                      type: "spring",
                      stiffness: 380,
                      damping: 32,
                      mass: 0.6,
                    }}
                    style={{
                      zIndex: tile.value,
                      willChange: "transform",
                    }}
                    className="absolute inset-0"
                  >
                    <Tile value={tile.value} theme={theme} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </LayoutGroup>
    </div>
  );
}
