import "server-only";
import { Redis } from "@upstash/redis";
import { NOTIF_KEYS } from "@/lib/server/notificationsStore";

function isAuthorized(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  return secret.length > 0 && auth === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  const now = Math.floor(Date.now() / 1000);

  // How many registered notification schedules exist?
  const registered = await redis.zcard(NOTIF_KEYS.dueZ); // ZCARD :contentReference[oaicite:2]{index=2}

  // Who is due next? (lowest score first)
  // WithScores returns interleaved [member, score, member, score, ...] :contentReference[oaicite:3]{index=3}
  const first = await redis.zrange(NOTIF_KEYS.dueZ, 0, 0, { withScores: true });

  let soonest: null | {
    member: string;
    nextSendAt: number;
    inSeconds: number;
  } = null;

  if (Array.isArray(first) && first.length >= 2) {
    const member = String(first[0]);
    const nextSendAt = Number(first[1]);
    soonest = {
      member,
      nextSendAt,
      inSeconds: nextSendAt - now,
    };
  }

  return Response.json({
    ok: true,
    now,
    registered,
    soonest,
  });
}
