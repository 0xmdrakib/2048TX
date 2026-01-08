import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/leaderboardStore";
import { NOTIF_KEYS, loadNotification } from "@/lib/server/notificationsStore";

export const dynamic = "force-dynamic";

const DEFAULT_APP_URL = "https://2048tx.vercel.app";

function checkAuth(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  return Boolean(secret && auth === `Bearer ${secret}`);
}

function stripTrailingSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ ok: false, error: "Redis not configured" }, { status: 500 });
  }
  const u = new URL(req.url);
  const fid = u.searchParams.get("fid");
  const appFid = u.searchParams.get("appFid");

  let member: string | null = null;

  if (fid && appFid) {
    member = `${Number(fid)}:${Number(appFid)}`;
  } else {
    const soonest = await redis.zrange(NOTIF_KEYS.dueZ, 0, 0);
    member = soonest?.[0] ? String(soonest[0]) : null;
  }

  if (!member) {
    return NextResponse.json({ ok: false, error: "No registered users" }, { status: 404 });
  }

  // loadNotification expects a memberId string like "fid:appFid"
  const rec = await loadNotification(redis, member);
  if (!rec) {
    return NextResponse.json({ ok: false, error: "No record found for member" }, { status: 404 });
  }

  const appUrl = stripTrailingSlash(process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL);

  const payload = {
    notificationId: crypto.randomUUID(),
    title: "2048 TX",
    body: "Test notification (admin send-test)",
    targetUrl: appUrl,
    tokens: [rec.token],
  };

  const resp = await fetch(rec.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  const r = (json as any)?.result ?? (json as any)?.data?.result ?? json;
  const successfulTokens = (r?.successfulTokens ?? []) as string[];
  const invalidTokens = (r?.invalidTokens ?? []) as string[];
  const rateLimitedTokens = (r?.rateLimitedTokens ?? r?.rateLimited ?? []) as string[];

  return NextResponse.json({
    ok: resp.ok,
    member,
    status: resp.status,
    parsed: {
      successful: successfulTokens.length,
      invalid: invalidTokens.length,
      rateLimited: rateLimitedTokens.length,
      tokenWasSuccessful: successfulTokens.includes(rec.token),
      tokenWasInvalid: invalidTokens.includes(rec.token),
      tokenWasRateLimited: rateLimitedTokens.includes(rec.token),
    },
    raw: json,
  });
}
