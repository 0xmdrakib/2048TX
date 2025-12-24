"use client";

import { THEMES, type ThemeId } from "@/lib/themes";
import { Button } from "./ui/Button";
import Sheet from "./ui/Sheet";

export default function ThemePicker({
  open,
  theme,
  onSelect,
  onClose,
}: {
  open: boolean;
  theme: ThemeId;
  onSelect: (t: ThemeId) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Theme" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={[
              "rounded-2xl border p-3 text-left transition",
              "bg-[var(--card)] border-[var(--cardBorder)] backdrop-blur",
              t.id === theme ? "ring-2 ring-black/40" : "hover:bg-[var(--chip)]",
            ].join(" ")}
          >
            <div className="text-sm font-semibold">{t.name}</div>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {[2, 4, 8, 16].map((v) => (
                <div
                  key={v}
                  className="h-6 rounded-lg"
                  style={{ background: t.tiles[v]?.bg ?? "#999" }}
                />
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>
    </Sheet>
  );
}
