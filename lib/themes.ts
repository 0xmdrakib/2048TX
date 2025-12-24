export type ThemeId = "classic" | "neon" | "pastel" | "amoled";

export type TileStyle = { bg: string; fg: string; border?: string; glow?: string };

type Theme = {
  id: ThemeId;
  name: string;
  tiles: Record<number, TileStyle>;
};

const classic: Theme = {
  id: "classic",
  name: "Classic",
  tiles: {
    2: { bg: "#eee4da", fg: "#776e65" },
    4: { bg: "#ede0c8", fg: "#776e65" },
    8: { bg: "#f2b179", fg: "#ffffff" },
    16: { bg: "#f59563", fg: "#ffffff" },
    32: { bg: "#f67c5f", fg: "#ffffff" },
    64: { bg: "#f65e3b", fg: "#ffffff" },
    128: { bg: "#edcf72", fg: "#ffffff" },
    256: { bg: "#edcc61", fg: "#ffffff" },
    512: { bg: "#edc850", fg: "#ffffff" },
    1024: { bg: "#edc53f", fg: "#ffffff" },
    2048: { bg: "#edc22e", fg: "#ffffff" },
  },
};

const neon: Theme = {
  id: "neon",
  name: "Neon",
  tiles: {
    2: { bg: "#2b2d42", fg: "#f8f7ff", border: "rgba(255,255,255,0.25)" },
    4: { bg: "#3a0ca3", fg: "#f8f7ff" },
    8: { bg: "#7209b7", fg: "#f8f7ff" },
    16: { bg: "#f72585", fg: "#0b0b10" },
    32: { bg: "#4cc9f0", fg: "#0b0b10" },
    64: { bg: "#80ffdb", fg: "#0b0b10" },
    128: { bg: "#caffbf", fg: "#0b0b10" },
    256: { bg: "#fdffb6", fg: "#0b0b10" },
    512: { bg: "#ffd6a5", fg: "#0b0b10" },
    1024: { bg: "#ffadad", fg: "#0b0b10" },
    2048: { bg: "#bdb2ff", fg: "#0b0b10" },
  },
};

const pastel: Theme = {
  id: "pastel",
  name: "Pastel",
  tiles: {
    2: { bg: "#f3e8ff", fg: "#2a1f3b" },
    4: { bg: "#e9d5ff", fg: "#2a1f3b" },
    8: { bg: "#c7d2fe", fg: "#2a1f3b" },
    16: { bg: "#bae6fd", fg: "#2a1f3b" },
    32: { bg: "#bbf7d0", fg: "#2a1f3b" },
    64: { bg: "#fed7aa", fg: "#2a1f3b" },
    128: { bg: "#fecaca", fg: "#2a1f3b" },
    256: { bg: "#fbcfe8", fg: "#2a1f3b" },
    512: { bg: "#ddd6fe", fg: "#2a1f3b" },
    1024: { bg: "#e7d8ff", fg: "#2a1f3b" },
    2048: { bg: "#ffe4f2", fg: "#2a1f3b" },
  },
};

const amoled: Theme = {
  id: "amoled",
  name: "AMOLED",
  tiles: {
    2: { bg: "#0f1016", fg: "#f6f6f7", border: "rgba(255,255,255,0.18)" },
    4: { bg: "#121424", fg: "#f6f6f7", border: "rgba(255,255,255,0.22)" },
    8: { bg: "#0b1b2a", fg: "#a6f8ff", glow: "0 0 18px rgba(166,248,255,0.25)" },
    16: { bg: "#190b2a", fg: "#ff9cf1", glow: "0 0 18px rgba(255,156,241,0.22)" },
    32: { bg: "#0b2a12", fg: "#b7ff9c", glow: "0 0 18px rgba(183,255,156,0.18)" },
    64: { bg: "#2a0b0b", fg: "#ff9c9c", glow: "0 0 18px rgba(255,156,156,0.18)" },
    128: { bg: "#241b0b", fg: "#ffe39c", glow: "0 0 18px rgba(255,227,156,0.16)" },
    256: { bg: "#0b2421", fg: "#9cffed", glow: "0 0 18px rgba(156,255,237,0.14)" },
    512: { bg: "#0b0f2a", fg: "#9cb5ff", glow: "0 0 18px rgba(156,181,255,0.14)" },
    1024: { bg: "#2a0b25", fg: "#ff9ce3", glow: "0 0 20px rgba(255,156,227,0.14)" },
    2048: { bg: "#2a260b", fg: "#fff59c", glow: "0 0 22px rgba(255,245,156,0.16)" },
  },
};

export const THEMES: Theme[] = [classic, neon, pastel, amoled];

export function getTileStyle(themeId: ThemeId, value: number): TileStyle {
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  return (
    theme.tiles[value] ?? {
      bg: themeId === "amoled" ? "#111116" : "#3a3a3a",
      fg: "#ffffff",
      border: themeId === "amoled" ? "rgba(255,255,255,0.18)" : undefined,
    }
  );
}
