import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  _redis = new Redis({ url, token });
  return _redis;
}

/**
 * Redis keys
 * - "lb:*" are global (all-time)
 * - "lb:weekly:*" are weekly seasons
 */
export const KEYS = {
  // -------- all-time leaderboard --------
  z: "lb:z",
  lastBlock: "lb:lastBlock",
  snapshots: "lb:snapshots",
  snapshotKey: (id: string) => `lb:snapshot:${id}`,

  // -------- weekly seasons --------
  weeklyEpoch: "lb:weekly:epoch",              // unix seconds when week0 starts
  weeklyLastBlock: "lb:weekly:lastBlock",      // last processed block for weekly sync
  weeklySnapshots: "lb:weekly:snapshots",      // list of saved week snapshot ids
  weeklyLastSnapWeek: "lb:weekly:lastSnapWeek",// last week index we snapshotted

  weeklyWeekZKey: (week: number) => `lb:weekly:week:${week}:z`,          // ZSET: address -> score
  weeklySnapshotKey: (week: number) => `lb:weekly:snapshot:${week}`,     // JSON snapshot blob
} as const;
