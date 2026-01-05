import "server-only";
import { Redis } from "@upstash/redis";

export const KEYS = {
  // All-time leaderboard
  z: "lb:z",
  lastBlock: "lb:lastBlock",

  // Legacy/all-time snapshots
  snapshots: "lb:snapshots",
  snapshotKey: (id: string) => `lb:snapshot:${id}`,

  // Weekly seasons
  weeklyEpoch: "lb:weekly:epoch",
  // Human-friendly: lets you see the current week directly in Upstash Data Browser.
  // This mirrors the DriftWing-style "current week" convenience key.
  weeklyCurrent: "lb:weekly:current",
  weeklyLastBlock: "lb:weekly:lastBlock",
  weeklyLastPublicSyncAt: "lb:weekly:lastPublicSyncAt",
  weeklyLastSnapshotCheckAt: "lb:weekly:lastSnapshotCheckAt",

  // ✅ This is the missing one causing your build error
  weeklyZ: (week: number) => `lb:weekly:week:${week}:z`,

  weeklySnapshots: "lb:weekly:snapshots",
  weeklySnapshotKey: (week: number) => `lb:weekly:snapshot:${week}`,
  weeklyLastSnapWeek: "lb:weekly:lastSnapWeek",
} as const;

let _redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  _redis = new Redis({ url, token });
  return _redis;
}
