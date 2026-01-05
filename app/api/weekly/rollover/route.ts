import { NextResponse } from "next/server";

import { KEYS, getRedis } from "@/lib/server/leaderboard/store";
import { getOrInitWeeklyEpoch, getWeekMeta } from "@/lib/server/leaderboard/weeklySeason";
import { snapshotCompletedWeeks } from "@/lib/server/leaderboard/maintenance";

export const dynamic = "force-dynamic";

/**
 * Public rollover endpoint (no secrets needed):
 * - If the week has ended, it snapshots the completed week(s)
 * - Updates the "current week" key
 *
 * This is designed to be called by the UI timer when it hits 00:00:00.
 * If nobody is online exactly at rollover, the next request will still finalize the snapshot.
 */
export async function POST() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      {
        ok: false,
        error: "Leaderboard storage not configured. Add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.",
      },
      { status: 500 }
    );
  }

  const snapshots = await snapshotCompletedWeeks(redis);

  const epochSeconds = await getOrInitWeeklyEpoch(redis);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const meta = getWeekMeta(epochSeconds, nowSeconds);

  await redis.set(KEYS.weeklyCurrent, {
    weekIndex: meta.weekIndex,
    weekStartsAt: new Date(meta.weekStartSeconds * 1000).toISOString(),
    weekEndsAt: new Date(meta.weekEndSeconds * 1000).toISOString(),
    secondsLeft: meta.secondsLeft,
    updatedAt: Date.now(),
  });

  return NextResponse.json({ ok: true, snapshots, ...meta });
}

// Convenience: allow GET too (easy to test in browser)
export async function GET() {
  return POST();
}
