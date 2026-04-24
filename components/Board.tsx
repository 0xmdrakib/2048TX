"use client";
import { AnimatePresence, motion } from "framer-motion";
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
      // GPU layer promotion — prevents in-app browser repaints from bleeding into the board
      style={{ transform: "translateZ(0)", willChange: "transform" }}
    >
      <div className={`grid h-full w-full gap-3 ${colsClass}`}>
        {cells.map(({ posKey, tile }) => (
          <div key={posKey} className="relative rounded-2xl bg-[var(--cell)]">
            <AnimatePresence initial={false}>
              {tile ? (
                <motion.div
                  key={tile.id}
                  // *** layoutId REMOVED intentionally ***
                  // layoutId triggers getBoundingClientRect() on every render,
                  // causing framer-motion to re-measure the entire board whenever
                  // the in-app browser chrome shifts the viewport (address bar
                  // show/hide, keyboard, etc.). This is the root cause of screen
                  // flickering in Warpcast / Instagram / TikTok in-app browsers.
                  // Without layoutId, tiles use only scale+opacity animations
                  // (handled in Tile.tsx) which run purely on the GPU compositor
                  // thread and never trigger layout reflow.
                  style={{ zIndex: tile.value, willChange: "transform, opacity" }}
                  className="absolute inset-0"
                >
                  <Tile value={tile.value} theme={theme} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
