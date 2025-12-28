import { NextRequest, NextResponse } from "next/server";
import { KEYS, getRedis } from "@/lib/server/leaderboardStore";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function isoWeekId(d: Date) {
  // ISO week like 2025-W01
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
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

  const now = new Date();
  const weekId = isoWeekId(now);
  const snapshotKey = KEYS.snapshotKey(weekId);

  const raw = (await redis.zrange(KEYS.z, 0, 99, { rev: true, withScores: true })) as Array<string | number>;
  const top100: Array<{ rank: number; address: string; bestScore: number }> = [];
  for (let i = 0; i < raw.length; i += 2) {
    top100.push({
      rank: top100.length + 1,
      address: String(raw[i]).toLowerCase(),
      bestScore: Number(raw[i + 1] ?? 0),
    });
  }

  const payload = {
    weekId,
    createdAt: now.toISOString(),
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 8453),
    contract: process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS ?? null,
    top100,
  };

  await redis.set(snapshotKey, payload);
  await redis.lpush(KEYS.snapshots, snapshotKey);

  return NextResponse.json({ ok: true, weekId, snapshotKey, count: top100.length });
}
