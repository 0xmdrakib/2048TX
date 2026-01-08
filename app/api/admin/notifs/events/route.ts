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
  const raw = (await redis.lrange(NOTIF_KEYS.events, 0, 49)) ?? [];

  const events = raw
    .map((s) => {
      try {
        return JSON.parse(String(s));
      } catch {
        return { raw: String(s) };
      }
    })
    // newest-first already, but ensure stable
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

  return NextResponse.json({ ok: true, count: events.length, events });
}
