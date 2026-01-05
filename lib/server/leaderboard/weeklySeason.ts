import "server-only";
import type { Redis } from "@upstash/redis";
import { KEYS } from "./store";

const WEEK_SECONDS = 7 * 24 * 60 * 60;

export type WeekMeta = {
  epochSeconds: number;
  weekIndex: number;
  weekStartSeconds: number;
  weekEndSeconds: number;
  secondsLeft: number;
};

/**
 * Weekly season model:
 * - We store a single epoch timestamp in Redis (unix seconds).
 * - Week index = floor((t - epoch) / 7 days).
 * - This lets you start counting "from now" and roll over every 7 days.
 *
 * If you want to restart the whole weekly system, delete KEYS.weeklyEpoch
 * (and optionally the weekly zsets/snapshots).
 */
export async function getOrInitWeeklyEpoch(redis: Redis): Promise<number> {
  const existing = await redis.get<number | string>(KEYS.weeklyEpoch);
  if (existing !== null && existing !== undefined) return Number(existing);

  const now = Math.floor(Date.now() / 1000);
  // set only if absent (race-safe)
  // Upstash supports options like { nx: true }
  // If another request set it first, we'll read again.
  await (redis as any).set(KEYS.weeklyEpoch, String(now), { nx: true });
  const after = await redis.get<number | string>(KEYS.weeklyEpoch);
  return Number(after ?? now);
}

export function getWeekIndex(epochSeconds: number, tsSeconds: number): number {
  const delta = tsSeconds - epochSeconds;
  if (delta < 0) return -1;
  return Math.floor(delta / WEEK_SECONDS);
}

export function getWeekBounds(epochSeconds: number, weekIndex: number) {
  const start = epochSeconds + weekIndex * WEEK_SECONDS;
  const end = start + WEEK_SECONDS;
  return { start, end };
}

export function getWeekMeta(epochSeconds: number, nowSeconds: number): WeekMeta {
  const weekIndex = getWeekIndex(epochSeconds, nowSeconds);
  const safeWeekIndex = weekIndex < 0 ? 0 : weekIndex;
  const { start, end } = getWeekBounds(epochSeconds, safeWeekIndex);
  return {
    epochSeconds,
    weekIndex: safeWeekIndex,
    weekStartSeconds: start,
    weekEndSeconds: end,
    secondsLeft: Math.max(0, end - nowSeconds),
  };
}
