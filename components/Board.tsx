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

  return (
    <div
      className={[
        "relative w-full max-w-md aspect-square rounded-[28px] p-3",
        "bg-[var(--board)] border border-[var(--cardBorder)] shadow-soft",
        isLocked ? "opacity-90" : "",
      ].join(" ")}
    >
      <div className="grid h-full w-full grid-cols-4 gap-3">
        {cells.map(({ posKey, tile }) => (
          <div
            key={posKey}
            className="relative rounded-2xl bg-[var(--cell)]"
          >
            <AnimatePresence>
              {tile ? (
                <motion.div key={tile.id} layout className="absolute inset-0">
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
