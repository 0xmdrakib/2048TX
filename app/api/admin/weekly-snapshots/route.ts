import { NextRequest, NextResponse } from "next/server";
import { KEYS, getRedis } from "@/lib/server/leaderboardStore";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
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

  const want = process.env.ADMIN_KEY;
  if (want) {
    const key = req.nextUrl.searchParams.get("key");
    if (key !== want) return unauthorized();
  }

  const weekParam = req.nextUrl.searchParams.get("week");
  if (weekParam) {
    const weekIndex = Number(weekParam);
    const snap = await redis.get<any>(KEYS.weeklySnapshotKey(weekIndex));
    if (!snap) return NextResponse.json({ ok: false, error: "Snapshot not found" }, { status: 404 });
    return NextResponse.json({ ok: true, snapshot: { key: KEYS.weeklySnapshotKey(weekIndex), ...snap } });
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "12"), 52);
  const keys = (await redis.lrange(KEYS.weeklySnapshots, 0, limit - 1)) as string[];

  const snapshots: any[] = [];
  for (const k of keys) {
    const snap = await redis.get<any>(k);
    if (snap) snapshots.push({ key: k, ...snap });
  }

  return NextResponse.json({ ok: true, count: snapshots.length, snapshots });
}
