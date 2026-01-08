import type { Redis } from "@upstash/redis";

export const NOTIF_KEYS = {
  dueZ: "notif:due:z",
  user: (fid: number, appFid: number) => `notif:user:${fid}:${appFid}`,
  events: "notif:events", // list of recent webhook events (debug)
} as const;

export type NotifCadenceHours = 1 | 6 | 12;

export type NotifRecord = {
  fid: number;
  appFid: number;
  token: string;
  url: string;

  cadenceHours: NotifCadenceHours;
  nextSendAt: number; // unix seconds

  // bookkeeping
  createdAt: number;
  updatedAt: number;

  lastSentAt?: number;
  lastAttemptAt?: number;
  lastResult?: "sent" | "invalid" | "rate_limited" | "error";
  invalidStreak?: number;
  lastError?: string;
  lastResponse?: {
    status: number;
    successful: number;
    invalid: number;
    rateLimited: number;
  };
};

export function member(fid: number, appFid: number) {
  return `${fid}:${appFid}`;
}

function computeNextSendAt(fromSeconds: number, cadenceHours: NotifCadenceHours) {
  return Math.floor(fromSeconds + cadenceHours * 60 * 60);
}

function normalizeCadenceHours(raw: unknown): NotifCadenceHours {
  const env = process.env.NOTIF_CADENCE_HOURS;
  const parsed = Number(env);
  if (parsed === 1 || parsed === 6 || parsed === 12) return parsed;
  // fallback to the stored value if it looks valid
  if (raw === 1 || raw === 6 || raw === 12) return raw;
  // safe default
  return 6;
}

async function persist(redis: Redis, rec: NotifRecord) {
  rec.updatedAt = Math.floor(Date.now() / 1000);
  await redis.set(NOTIF_KEYS.user(rec.fid, rec.appFid), JSON.stringify(rec));
  await redis.zadd(NOTIF_KEYS.dueZ, {
    score: rec.nextSendAt,
    member: member(rec.fid, rec.appFid),
  });
}

export async function upsertNotificationDetails(
  redis: Redis,
  fid: number,
  appFid: number,
  details: { token: string; url: string },
) {
  const now = Math.floor(Date.now() / 1000);

  // If an old record exists, keep its bookkeeping.
  const existing = await loadNotification(redis, member(fid, appFid));

  const cadenceHours = normalizeCadenceHours(existing?.cadenceHours);

  const rec: NotifRecord = {
    fid,
    appFid,
    token: details.token,
    url: details.url,

    cadenceHours,
    nextSendAt: computeNextSendAt(now, cadenceHours),

    createdAt: existing?.createdAt ?? now,
    updatedAt: now,

    lastSentAt: existing?.lastSentAt,
    lastAttemptAt: existing?.lastAttemptAt,
    lastResult: existing?.lastResult,
    invalidStreak: existing?.invalidStreak ?? 0,
    lastError: existing?.lastError,
    lastResponse: existing?.lastResponse,
  };

  await persist(redis, rec);
  return rec;
}

export async function loadNotification(redis: Redis, memberId: string): Promise<NotifRecord | null> {
  const [fidStr, appFidStr] = memberId.split(":");
  const fid = Number(fidStr);
  const appFid = Number(appFidStr);
  if (!Number.isFinite(fid) || !Number.isFinite(appFid)) return null;

  const raw = await redis.get<string>(NOTIF_KEYS.user(fid, appFid));
  if (!raw) return null;

  let parsed: any;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  // Minimal validation / migration.
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.token !== "string" || typeof parsed.url !== "string") return null;

  const now = Math.floor(Date.now() / 1000);
  const cadenceHours = normalizeCadenceHours(parsed.cadenceHours);

  const rec: NotifRecord = {
    fid,
    appFid,
    token: parsed.token,
    url: parsed.url,

    cadenceHours,
    nextSendAt: typeof parsed.nextSendAt === "number" ? parsed.nextSendAt : computeNextSendAt(now, cadenceHours),

    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : now,
    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : now,

    lastSentAt: typeof parsed.lastSentAt === "number" ? parsed.lastSentAt : undefined,
    lastAttemptAt: typeof parsed.lastAttemptAt === "number" ? parsed.lastAttemptAt : undefined,
    lastResult: parsed.lastResult,
    invalidStreak: typeof parsed.invalidStreak === "number" ? parsed.invalidStreak : 0,
    lastError: typeof parsed.lastError === "string" ? parsed.lastError : undefined,
    lastResponse: parsed.lastResponse,
  };

  // If cadence changed (env), recompute nextSendAt based on lastSentAt.
  if (rec.cadenceHours !== parsed.cadenceHours) {
    const base = rec.lastSentAt ?? now;
    rec.nextSendAt = computeNextSendAt(base, rec.cadenceHours);
    await persist(redis, rec);
  }

  return rec;
}

export async function disableNotifications(redis: Redis, fid: number, appFid: number) {
  await redis.del(NOTIF_KEYS.user(fid, appFid));
  await redis.zrem(NOTIF_KEYS.dueZ, member(fid, appFid));
}

export async function reschedule(redis: Redis, rec: NotifRecord, whenSeconds: number) {
  rec.nextSendAt = whenSeconds;
  await persist(redis, rec);
}

export async function markSent(redis: Redis, rec: NotifRecord) {
  const now = Math.floor(Date.now() / 1000);
  rec.lastSentAt = now;
  rec.lastAttemptAt = now;
  rec.lastResult = "sent";
  rec.invalidStreak = 0;
  rec.lastError = undefined;
  rec.nextSendAt = computeNextSendAt(now, rec.cadenceHours);
  await persist(redis, rec);
}

export async function markAttempt(
  redis: Redis,
  rec: NotifRecord,
  patch: {
    result: NotifRecord["lastResult"];
    response?: NotifRecord["lastResponse"];
    error?: string;
    bumpInvalid?: boolean;
  },
) {
  const now = Math.floor(Date.now() / 1000);
  rec.lastAttemptAt = now;
  rec.lastResult = patch.result;
  rec.lastResponse = patch.response;
  rec.lastError = patch.error;
  if (patch.bumpInvalid) rec.invalidStreak = (rec.invalidStreak ?? 0) + 1;
  await persist(redis, rec);
}

