import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/leaderboardStore";
import { NOTIF_KEYS } from "@/lib/server/notificationsStore";

export const dynamic = "force-dynamic";

function checkAuth(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  return Boolean(secret && auth === `Bearer ${secret}`);
}

export async function GET(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const redis = getRedis();
  const now = Math.floor(Date.now() / 1000);

  const [registered, dueNow, soonestArr] = await Promise.all([
    redis.zcard(NOTIF_KEYS.dueZ),
    redis.zcount(NOTIF_KEYS.dueZ, 0, now),
    redis.zrange(NOTIF_KEYS.dueZ, 0, 0, { withScores: true }),
  ]);

  const soonest =
    soonestArr && soonestArr.length >= 2
      ? {
          member: String(soonestArr[0]),
          nextSendAt: Number(soonestArr[1]),
          inSeconds: Math.max(0, Number(soonestArr[1]) - now),
        }
      : null;

  return NextResponse.json({
    ok: true,
    now,
    registered,
    dueNow,
    soonest,
  });
}
