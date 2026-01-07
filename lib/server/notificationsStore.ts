import "server-only";
import type { Redis } from "@upstash/redis";

// Dedicated keys so we don't mix notification data with leaderboard keys.
export const NOTIF_KEYS = {
  // JSON record per (fid, appFid)
  user: (fid: number, appFid: number) => `notif:user:${fid}:${appFid}`,
  // Sorted set of due deliveries: member = `${fid}:${appFid}`, score = nextSendAt (epoch seconds)
  dueZ: "notif:due",
} as const;

/**
 * Supported cadences (hours).
 * - Use 1 for testing
 * - Use 6 or 12 for production
 */
export type CadenceHours = 1 | 6 | 12;

export type NotifRecord = {
  fid: number;
  appFid: number;
  url: string;
  token: string;
  cadenceHours: CadenceHours;
  nextSendAt: number; // epoch seconds
  lastSentAt?: number; // epoch seconds
};

function member(fid: number, appFid: number) {
  return `${fid}:${appFid}`;
}

function parseCadenceHours(raw: string | undefined): CadenceHours {
  const v = (raw ?? "12").trim();

  // ✅ test mode
  if (v === "1") return 1;

  // ✅ prod modes
  if (v === "6") return 6;
  if (v === "12") return 12;

  // Safe fallback
  return 12;
}

export function getDefaultCadenceHours(): CadenceHours {
  return parseCadenceHours(process.env.NOTIF_CADENCE_HOURS);
}

function computeNextSendAt(nowSec: number, cadenceHours: CadenceHours) {
  return nowSec + cadenceHours * 3600;
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
    nextSendAt: computeNextSendAt(now, cadenceHours),
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
    const rec = JSON.parse(raw) as NotifRecord;

    // Basic sanity checks
    if (!rec || typeof rec !== "object") return null;
    if (typeof rec.fid !== "number" || typeof rec.appFid !== "number") return null;
    if (typeof rec.url !== "string" || typeof rec.token !== "string") return null;
    if (typeof rec.nextSendAt !== "number") return null;

    // Ensure cadence is one of our allowed values; otherwise fallback to env default.
    if (rec.cadenceHours !== 1 && rec.cadenceHours !== 6 && rec.cadenceHours !== 12) {
      rec.cadenceHours = getDefaultCadenceHours();
    }

    return rec;
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
  rec.nextSendAt = computeNextSendAt(now, rec.cadenceHours);

  await redis.set(NOTIF_KEYS.user(rec.fid, rec.appFid), JSON.stringify(rec));
  await redis.zadd(NOTIF_KEYS.dueZ, { score: rec.nextSendAt, member: member(rec.fid, rec.appFid) });
}
