import "server-only";
import type { Redis } from "@upstash/redis";

// Dedicated keys so we don't mix notification data with leaderboard keys.
export const NOTIF_KEYS = {
  // JSON record per (fid, appFid)
  user: (fid: number, appFid: number) => `notif:user:${fid}:${appFid}`,
  // Sorted set of due deliveries: member = `${fid}:${appFid}`, score = nextSendAt (epoch seconds)
  dueZ: "notif:due",
} as const;

export type CadenceHours = 6 | 12;

export type NotifRecord = {
  fid: number;
  appFid: number;
  url: string;
  token: string;
  cadenceHours: CadenceHours;
  nextSendAt: number;
  lastSentAt?: number;
};

function member(fid: number, appFid: number) {
  return `${fid}:${appFid}`;
}

export function getDefaultCadenceHours(): CadenceHours {
  const raw = (process.env.NOTIF_CADENCE_HOURS ?? "12").trim();
  return raw === "6" ? 6 : 12;
}

export async function upsertNotificationDetails(
  redis: Redis,
  args: { fid: number; appFid: number; url: string; token: string; cadenceHours?: CadenceHours }
) {
  const now = Math.floor(Date.now() / 1000);
  const cadenceHours = args.cadenceHours ?? getDefaultCadenceHours();

  const rec: NotifRecord = {
    fid: args.fid,
    appFid: args.appFid,
    url: args.url,
    token: args.token,
    cadenceHours,
    nextSendAt: now + cadenceHours * 3600,
  };

  await redis.set(NOTIF_KEYS.user(args.fid, args.appFid), JSON.stringify(rec));
  await redis.zadd(NOTIF_KEYS.dueZ, { score: rec.nextSendAt, member: member(args.fid, args.appFid) });

  return rec;
}

export async function disableNotifications(redis: Redis, fid: number, appFid: number) {
  await redis.del(NOTIF_KEYS.user(fid, appFid));
  await redis.zrem(NOTIF_KEYS.dueZ, member(fid, appFid));
}

export async function loadNotification(redis: Redis, fid: number, appFid: number): Promise<NotifRecord | null> {
  const raw = await redis.get<string>(NOTIF_KEYS.user(fid, appFid));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NotifRecord;
  } catch {
    return null;
  }
}

export async function reschedule(redis: Redis, rec: NotifRecord, whenSeconds: number) {
  rec.nextSendAt = whenSeconds;
  await redis.set(NOTIF_KEYS.user(rec.fid, rec.appFid), JSON.stringify(rec));
  await redis.zadd(NOTIF_KEYS.dueZ, { score: rec.nextSendAt, member: member(rec.fid, rec.appFid) });
}

export async function markSent(redis: Redis, rec: NotifRecord) {
  const now = Math.floor(Date.now() / 1000);
  rec.lastSentAt = now;
  rec.nextSendAt = now + rec.cadenceHours * 3600;
  await redis.set(NOTIF_KEYS.user(rec.fid, rec.appFid), JSON.stringify(rec));
  await redis.zadd(NOTIF_KEYS.dueZ, { score: rec.nextSendAt, member: member(rec.fid, rec.appFid) });
}
