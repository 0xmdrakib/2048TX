import { NextRequest, NextResponse } from "next/server";
import { KEYS, getRedis } from "@/lib/server/leaderboardStore";
import { getOrInitWeeklyEpoch, getWeekMeta } from "@/lib/server/weeklySeason";
import { syncWeeklyLeaderboard } from "@/lib/server/syncWeeklyLeaderboard";

type Entry = { address: string; bestScore: number };

export const dynamic = "force-dynamic";

function json(data: any, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  // Avoid stale CDN/browser caching; this endpoint is meant to be "live".
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET(req: NextRequest) {
  const contract = process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS ?? null;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 8453);

  const redis = getRedis();
  if (!redis) {
    return json(
      {
        ok: false,
        error: "Leaderboard storage not configured. Add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.",
      },
      { status: 500 }
    );
  }

  // Public "refresh": triggers a small sync, throttled (so a spammer can't hammer your RPC).
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  if (refresh) {
    const now = Date.now();
    const last = Number((await redis.get<number | string>(KEYS.weeklyLastPublicSyncAt)) ?? 0);
    if (!last || now - last > 20_000) {
      await redis.set(KEYS.weeklyLastPublicSyncAt, String(now));
      // Limit the amount of work a public refresh can do
      await syncWeeklyLeaderboard(redis, { maxBlocks: 4000n });
    }
  }

  const epochSeconds = await getOrInitWeeklyEpoch(redis);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const meta = getWeekMeta(epochSeconds, nowSeconds);

  const weekKey = KEYS.weeklyZ(meta.weekIndex);

  const raw = (await redis.zrange(weekKey, 0, 99, { rev: true, withScores: true })) as Array<
    string | number
  >;

  const top100: Entry[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const address = String(raw[i] ?? "");
    const bestScore = Number(raw[i + 1] ?? 0);
    if (address) top100.push({ address, bestScore });
  }

  const lastBlock = (await redis.get<number | string>(KEYS.weeklyLastBlock)) ?? null;

  return json({
    ok: true,
    scope: "weekly",
    chainId,
    contract,
    weekIndex: meta.weekIndex,
    weekStartsAt: new Date(meta.weekStartSeconds * 1000).toISOString(),
    weekEndsAt: new Date(meta.weekEndSeconds * 1000).toISOString(),
    secondsLeft: meta.secondsLeft,
    updatedFromBlock: lastBlock,
    top100,
  });
}
