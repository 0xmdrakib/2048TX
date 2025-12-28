import "server-only";

import { Redis } from "@upstash/redis";

/**
 * Storage model:
 * - Sorted set: lb:z  (member=address, score=bestScore)
 * - String:    lb:lastBlock
 * - List:      lb:snapshots   (list of snapshot keys)
 * - String:    lb:snapshot:<YYYY-WW> (JSON blob)
 *
 * NOTE:
 * We initialize Redis lazily so missing/invalid env vars don't crash the module
 * at import-time (which makes Next.js return an HTML error page).
 */

export const KEYS = {
  z: "lb:z",
  lastBlock: "lb:lastBlock",
  snapshots: "lb:snapshots",
  snapshotKey: (id: string) => `lb:snapshot:${id}`,
};

let _redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  _redis = new Redis({ url, token });
  return _redis;
}
