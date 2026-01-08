import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/leaderboardStore";
import {
  NOTIF_KEYS,
  disableNotifications,
  loadNotification,
  markAttempt,
  markSent,
  reschedule,
} from "@/lib/server/notificationsStore";

export const dynamic = "force-dynamic";

const DEFAULT_APP_URL = "https://2048tx.vercel.app";
const INVALID_DISABLE_THRESHOLD = 3; // avoid deleting tokens due to one flaky response

function stripTrailingSlash(u: string) {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

function authOk(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const redis = getRedis();
  const now = Math.floor(Date.now() / 1000);

  const dueMembers = await redis.zrange(NOTIF_KEYS.dueZ, 0, now, {
    byScore: true,
    offset: 0,
    count: 200,
  });

  let sent = 0;
  let invalid = 0;
  let invalidDisabled = 0;
  let rateLimited = 0;
  let errors = 0;

  for (const member of dueMembers) {
    const [fidStr, appFidStr] = String(member).split(":");
    const fid = Number(fidStr);
    const appFid = Number(appFidStr);
    if (!Number.isFinite(fid) || !Number.isFinite(appFid)) {
      await redis.zrem(NOTIF_KEYS.dueZ, String(member));
      continue;
    }

    const rec = await loadNotification(redis, fid, appFid);
    if (!rec) {
      // Stale ZSET member
      await redis.zrem(NOTIF_KEYS.dueZ, String(member));
      continue;
    }

    // Ensure targetUrl is on the *exact* Mini App domain.
    const appUrl = stripTrailingSlash(process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL);

    // Make notificationId unique per-user per cadence slot.
    const slot = Math.floor(now / (rec.cadenceHours * 60 * 60));
    const notificationId = `cadence-${rec.cadenceHours}-slot-${slot}-fid-${fid}`;

    const payload = {
      notificationId,
      title: "2048 TX",
      body: "Play a quick round and climb the leaderboard.",
      targetUrl: appUrl,
      tokens: [rec.token],
    };

    let res: Response;
    let raw = "";
    try {
      res = await fetch(rec.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      raw = await res.text();
    } catch (e: any) {
      await markAttempt(redis, rec, {
        result: "error",
        error: `fetch failed: ${e?.message ?? String(e)}`,
      });
      await reschedule(redis, rec, now + 10 * 60);
      errors++;
      continue;
    }

    let json: any = null;
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        // keep json null
      }
    }

    if (!res.ok) {
      const snippet = raw ? raw.slice(0, 300) : "";
      await markAttempt(redis, rec, {
        result: "error",
        error: `notification service HTTP ${res.status}${snippet ? `: ${snippet}` : ""}`,
        response: {
          status: res.status,
          successful: 0,
          invalid: 0,
          rateLimited: 0,
        },
      });
      await reschedule(redis, rec, now + 10 * 60);
      errors++;
      continue;
    }

    const result = json?.result ?? json?.data?.result ?? json ?? {};
    const successfulTokens: string[] = result?.successfulTokens ?? [];
    const invalidTokens: string[] = result?.invalidTokens ?? [];
    const rateLimitedTokens: string[] =
      result?.rateLimitedTokens ?? result?.rateLimited ?? result?.rateLimitedTokens ?? [];

    const summary = {
      status: res.status,
      successful: successfulTokens.length,
      invalid: invalidTokens.length,
      rateLimited: rateLimitedTokens.length,
    };

    if (invalidTokens.includes(rec.token)) {
      const nextStreak = (rec.invalidStreak ?? 0) + 1;
      await markAttempt(redis, rec, {
        result: "invalid",
        response: summary,
        bumpInvalid: true,
      });
      invalid++;

      if (nextStreak >= INVALID_DISABLE_THRESHOLD) {
        await disableNotifications(redis, fid, appFid);
        invalidDisabled++;
      } else {
        // Retry soon; sometimes tokens can be temporarily invalid during activation.
        await reschedule(redis, rec, now + 10 * 60);
      }
      continue;
    }

    if (rateLimitedTokens.includes(rec.token)) {
      await markAttempt(redis, rec, { result: "rateLimited", response: summary });
      await reschedule(redis, rec, now + 15 * 60);
      rateLimited++;
      continue;
    }

    if (successfulTokens.includes(rec.token)) {
      await markSent(redis, rec);
      sent++;
      continue;
    }

    // Defensive: 200 but token not in any list
    await markAttempt(redis, rec, {
      result: "error",
      response: summary,
      error: "200 OK but token not present in successful/invalid/rateLimited arrays",
    });
    await reschedule(redis, rec, now + 10 * 60);
    errors++;
  }

  const registered = await redis.zcard(NOTIF_KEYS.dueZ);

  return NextResponse.json({
    ok: true,
    now,
    due: dueMembers.length,
    registered,
    sent,
    invalid,
    invalidDisabled,
    rateLimited,
    errors,
  });
}
