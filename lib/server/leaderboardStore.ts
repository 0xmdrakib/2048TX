import "server-only";

import { Redis } from "@upstash/redis";

/**
 * Storage model:
 * - Sorted set: lb:z  (member=address, score=bestScore)
 * - String:    lb:lastBlock
 * - List:      lb:snapshots   (list of snapshot keys)
 * - String:    lb:snapshot:<YYYY-WW> (JSON blob)
 */
export const redis = Redis.fromEnv();

export const KEYS = {
  z: "lb:z",
  lastBlock: "lb:lastBlock",
  snapshots: "lb:snapshots",
  snapshotKey: (id: string) => `lb:snapshot:${id}`,
};
