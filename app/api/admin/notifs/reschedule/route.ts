import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/leaderboardStore";
import { NOTIF_KEYS, NotifCadenceHours, loadNotification } from "@/lib/server/notificationsStore";

export const dynamic = "force-dynamic";

function checkAuth(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  return Boolean(secret && auth === `Bearer ${secret}`);
}

function isCadenceHours(x: string | null): x is `${NotifCadenceHours}` {
  return x === "1" || x === "6" || x === "12";
}

export async function GET(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const u = new URL(req.url);
  const hoursParam = u.searchParams.get("hours");
  if (!isCadenceHours(hoursParam)) {
    return NextResponse.json(
      { ok: false, error: "hours must be 1, 6, or 12" },
      { status: 400 }
    );
  }
  const hours = Number(hoursParam) as NotifCadenceHours;
  const memberParam = u.searchParams.get("member");

  const redis = getRedis();
  const now = Math.floor(Date.now() / 1000);

  const members = memberParam
    ? [memberParam]
    : (await redis.zrange(NOTIF_KEYS.dueZ, 0, -1)).map((m) => String(m));

  let updated = 0;
  let missing = 0;

  for (const member of members) {
    const [fidStr, appFidStr] = member.split(":");
    const fid = Number(fidStr);
    const appFid = Number(appFidStr);
    if (!Number.isFinite(fid) || !Number.isFinite(appFid)) continue;

    const rec = await loadNotification(redis, fid, appFid);
    if (!rec) {
      missing++;
      continue;
    }

    rec.cadenceHours = hours;
    rec.nextSendAt = now + hours * 60 * 60;
    rec.updatedAt = now;

    await redis.set(NOTIF_KEYS.user(fid, appFid), JSON.stringify(rec));
    await redis.zadd(NOTIF_KEYS.dueZ, {
      score: rec.nextSendAt,
      member: `${fid}:${appFid}`,
    });
    updated++;
  }

  return NextResponse.json({ ok: true, updated, missing, total: members.length, hours });
}
