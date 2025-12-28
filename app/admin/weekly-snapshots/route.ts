import { NextRequest, NextResponse } from "next/server";
import { KEYS, redis } from "@/lib/server/leaderboardStore";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  // Simple protection: pass ?key=... or header x-admin-key: ...
  const want = process.env.ADMIN_KEY;
  if (want) {
    const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("x-admin-key");
    if (key !== want) return unauthorized();
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "12"), 52);
  const keys = (await redis.lrange(KEYS.snapshots, 0, limit - 1)) as string[];

  const snapshots = [];
  for (const k of keys) {
    const snap = await redis.get<any>(k);
    if (snap) snapshots.push({ key: k, ...snap });
  }

  return NextResponse.json({ ok: true, count: snapshots.length, snapshots });
}
