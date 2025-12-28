import { NextRequest, NextResponse } from "next/server";
import { KEYS, getRedis } from "@/lib/server/leaderboardStore";
import { getOrInitWeeklyEpoch, getWeekMeta, getWeekBounds } from "@/lib/server/weeklySeason";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) return unauthorized();

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      {
        ok: false,
        error: "Upstash Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
      },
      { status: 500 }
    );
  }

  const epochSeconds = await getOrInitWeeklyEpoch(redis);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const meta = getWeekMeta(epochSeconds, nowSeconds);

  // The week that just finished
  const targetWeek = meta.weekIndex - 1;
  if (targetWeek < 0) {
    return NextResponse.json({ ok: true, message: "No completed week yet.", weekIndex: meta.weekIndex });
  }

  const lastSnap = Number((await redis.get<number | string>(KEYS.weeklyLastSnapWeek)) ?? -1);

  const snapped: number[] = [];

  for (let w = lastSnap + 1; w <= targetWeek; w++) {
    const raw = (await redis.zrange(KEYS.weeklyZ(w), 0, 99, { rev: true, withScores: true })) as Array<
      string | number
    >;

    const top100: Array<{ address: string; bestScore: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      const address = String(raw[i] ?? "");
      const bestScore = Number(raw[i + 1] ?? 0);
      if (address) top100.push({ address, bestScore });
    }

    const { start, end } = getWeekBounds(epochSeconds, w);

    const payload = {
      weekIndex: w,
      createdAt: new Date().toISOString(),
      weekStartsAt: new Date(start * 1000).toISOString(),
      weekEndsAt: new Date(end * 1000).toISOString(),
      chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 8453),
      contract: process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS ?? null,
      top100,
    };

    const key = KEYS.weeklySnapshotKey(w);
    await redis.set(key, payload);
    await redis.lpush(KEYS.weeklySnapshots, key);
    await redis.set(KEYS.weeklyLastSnapWeek, String(w));

    snapped.push(w);
  }

  return NextResponse.json({ ok: true, snappedWeeks: snapped, count: snapped.length });
}
