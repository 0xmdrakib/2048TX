import { NextResponse } from "next/server";
import { KEYS, redis } from "@/lib/server/leaderboardStore";

type Entry = { address: string; bestScore: number };

export const dynamic = "force-dynamic";

export async function GET() {
  const contract = process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS ?? null;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 8453);

  // If Upstash isn't configured, return a friendly error for the UI.
  const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!hasRedis) {
    return NextResponse.json(
      {
        ok: false,
        error: "Leaderboard storage not configured. Add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.",
      },
      { status: 500 }
    );
  }

  // Top 100 (highest scores first)
    const raw = (await redis.zrange(KEYS.z, 0, 99, { rev: true, withScores: true })) as Array<string | number>;

  const top100: Entry[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const address = String(raw[i]).toLowerCase();
    const bestScore = Number(raw[i + 1] ?? 0);
    top100.push({ address, bestScore });
  }

  const lastBlock = (await redis.get<number | string>(KEYS.lastBlock)) ?? null;

  return NextResponse.json({
    ok: true,
    chainId,
    contract,
    updatedFromBlock: lastBlock,
    top100,
  });
}
