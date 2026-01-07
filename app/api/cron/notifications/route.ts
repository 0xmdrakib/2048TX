import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/server/leaderboardStore";
import {
  NOTIF_KEYS,
  disableNotifications,
  loadNotification,
  markSent,
  reschedule,
} from "@/lib/server/notificationsStore";

export const dynamic = "force-dynamic";

const TITLE = "2048 TX Game 🧩";
const BODY = "One quick round? Try to beat your score.";

function stripTrailingSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function memberToIds(m: string) {
  const [fidStr, appFidStr] = m.split(":");
  return { fid: Number(fidStr), appFid: Number(appFidStr) };
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

  const now = Math.floor(Date.now() / 1000);
  const appUrl = stripTrailingSlash(process.env.NEXT_PUBLIC_APP_URL ?? "https://2048tx.vercel.app/");

  // Pull up to N due deliveries. Keep it small so a single run never times out.
  const due = (await redis.zrange(NOTIF_KEYS.dueZ, 0, now, {
    byScore: true,
    offset: 0,
    count: 200,
  })) as string[];

  let sent = 0;
  let invalid = 0;
  let rateLimited = 0;

  for (const m of due) {
    const { fid, appFid } = memberToIds(m);
    const rec = await loadNotification(redis, fid, appFid);
    if (!rec) {
      // Clean up dangling member
      await redis.zrem(NOTIF_KEYS.dueZ, m);
      continue;
    }

    // Use a stable id per cadence-window to avoid duplicates within a 24h dedupe window.
    // (fid, notificationId) is used for dedupe by clients.
    const slot = Math.floor(now / (rec.cadenceHours * 3600));
    const notificationId = `reminder-2048-${rec.cadenceHours}h-${slot}`;

    let responseJson: any = null;
    let ok = false;

    try {
      const res = await fetch(rec.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationId,
          title: TITLE,
          body: BODY,
          targetUrl: appUrl,
          tokens: [rec.token],
        }),
      });

      ok = res.ok;
      responseJson = await res.json().catch(() => null);
    } catch {
      // Network failure: retry later
      await reschedule(redis, rec, now + 15 * 60);
      continue;
    }

    const result = responseJson?.result ?? responseJson?.data?.result ?? responseJson;
    const successfulTokens: string[] = Array.isArray(result?.successfulTokens) ? result.successfulTokens : [];
    const invalidTokens: string[] = Array.isArray(result?.invalidTokens) ? result.invalidTokens : [];
    const rateLimitedTokens: string[] = Array.isArray(result?.rateLimitedTokens) ? result.rateLimitedTokens : [];

    if (invalidTokens.includes(rec.token)) {
      await disableNotifications(redis, fid, appFid);
      invalid++;
      continue;
    }

    if (rateLimitedTokens.includes(rec.token)) {
      await reschedule(redis, rec, now + 15 * 60);
      rateLimited++;
      continue;
    }

    if (successfulTokens.includes(rec.token) || ok) {
      await markSent(redis, rec);
      sent++;
      continue;
    }

    // Unknown response shape: retry later
    await reschedule(redis, rec, now + 15 * 60);
  }

  return NextResponse.json({ ok: true, due: due.length, sent, invalid, rateLimited });
}
