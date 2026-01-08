import { NextRequest, NextResponse } from "next/server";
import {
  ParseWebhookEvent,
  parseWebhookEvent,
  verifyAppKeyWithNeynar,
} from "@farcaster/miniapp-node";

import { getRedis } from "@/lib/server/leaderboardStore";
import {
  NOTIF_KEYS,
  disableNotifications,
  upsertNotificationDetails,
} from "@/lib/server/notificationsStore";

// Webhooks must respond quickly (hosts wait for a successful response before activating tokens).
// Keep this endpoint "store-and-ACK".
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Upstash Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
      },
      { status: 500 }
    );
  }

  let requestJson: unknown;
  try {
    requestJson = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  let data: Awaited<ReturnType<typeof parseWebhookEvent>>;
  try {
    data = await parseWebhookEvent(requestJson, verifyAppKeyWithNeynar);
  } catch (e: unknown) {
    const error = e as ParseWebhookEvent.ErrorType;
    return NextResponse.json(
      { ok: false, error: error?.name ?? "WebhookVerifyError" },
      { status: 400 }
    );
  }

  const fid = data.fid;
  const appFid = data.appFid;
  const event = data.event as {
    event: string;
    notificationDetails?: { token: string; url: string };
  };

  // Debug breadcrumb: keep a small rolling log of webhook events.
  // (Never store tokens here.)
  try {
    const ts = Math.floor(Date.now() / 1000);
    await redis.lpush(
      NOTIF_KEYS.events,
      JSON.stringify({ ts, event: event.event, fid, appFid })
    );
    await redis.ltrim(NOTIF_KEYS.events, 0, 199);
  } catch {
    // ignore
  }

  try {
    switch (event.event) {
      case "miniapp_added":
      case "notifications_enabled": {
        const details = event.notificationDetails;
        if (details?.token && details?.url) {
          // Persist token + URL and schedule next send.
          await upsertNotificationDetails(redis, fid, appFid, {
            token: details.token,
            url: details.url,
          });
        }
        break;
      }
      case "miniapp_removed":
      case "notifications_disabled": {
        await disableNotifications(redis, fid, appFid);
        break;
      }
      default:
        // Ignore unknown events (forward-compat)
        break;
    }
  } catch {
    // Don't fail the webhook: return ok so the host doesn't block token activation.
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
