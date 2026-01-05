import "server-only";

import type { Redis } from "@upstash/redis";
import { publicClient, scoreSubmittedEvent } from "../chainClient";
import { KEYS } from "./store";
import { syncWeeklyLeaderboard } from "./syncWeekly";
import { getOrInitWeeklyEpoch, getWeekMeta, getWeekBounds, type WeekMeta } from "./weeklySeason";

// How many blocks to query per getLogs call (keeps RPC happy).
const CHUNK = 2000n;

export type AllTimeSyncResult = {
  ok: boolean;
  error?: string;
  contract: string;
  fromBlock: bigint;
  toBlock: bigint;
  logsProcessed: number;
  usersTouched: number;
};

export async function syncAllTimeLeaderboard(
  redis: Redis,
  opts?: { maxBlocks?: bigint }
): Promise<AllTimeSyncResult> {
  const contract = process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS;
  if (!contract) {
    return {
      ok: false,
      error: "Missing NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS",
      contract: "",
      fromBlock: 0n,
      toBlock: 0n,
      logsProcessed: 0,
      usersTouched: 0,
    };
  }

  const deploy = process.env.SCORE_CONTRACT_DEPLOY_BLOCK;
  const last = await redis.get<number | string>(KEYS.lastBlock);
  const latest = await publicClient.getBlockNumber();

  let fromBlock =
    last !== null && last !== undefined
      ? BigInt(last) + 1n
      : deploy
        ? BigInt(deploy)
        : 0n;

  let toBlock = latest;
  if (opts?.maxBlocks && opts.maxBlocks > 0n) {
    const maxTo = fromBlock + opts.maxBlocks - 1n;
    if (maxTo < toBlock) toBlock = maxTo;
  }

  let logsProcessed = 0;
  const touched = new Set<string>();

  if (fromBlock <= toBlock) {
    for (let start = fromBlock; start <= toBlock; start += CHUNK) {
      const end = start + CHUNK - 1n > toBlock ? toBlock : start + CHUNK - 1n;

      const logs = await publicClient.getLogs({
        address: contract as `0x${string}`,
        event: scoreSubmittedEvent,
        fromBlock: start,
        toBlock: end,
      });

      if (logs.length) {
        const pipeline = redis.pipeline();
        for (const log of logs as any[]) {
          const player = (String(log.args.player) as string).toLowerCase();
          const bestScore = Number(log.args.bestScore);
          pipeline.zadd(KEYS.z, { score: bestScore, member: player });
          touched.add(player);
        }
        await pipeline.exec();
        logsProcessed += logs.length;
      }

      await redis.set(KEYS.lastBlock, String(end));
    }
  }

  return {
    ok: true,
    contract,
    fromBlock,
    toBlock,
    logsProcessed,
    usersTouched: touched.size,
  };
}

export type SnapshotResult = {
  ok: boolean;
  currentWeekIndex: number;
  snappedWeeks: number[];
};

async function writeCurrentWeek(redis: Redis, meta: WeekMeta) {
  // A small convenience key so you can quickly see the current week in Upstash.
  // Not required for the app logic, but helps with debugging.
  await redis.set(KEYS.weeklyCurrent, {
    weekIndex: meta.weekIndex,
    weekStartsAt: new Date(meta.weekStartSeconds * 1000).toISOString(),
    weekEndsAt: new Date(meta.weekEndSeconds * 1000).toISOString(),
    secondsLeft: meta.secondsLeft,
    updatedAt: Date.now(),
  });
}

export async function snapshotCompletedWeeks(redis: Redis): Promise<SnapshotResult> {
  const epochSeconds = await getOrInitWeeklyEpoch(redis);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const meta = getWeekMeta(epochSeconds, nowSeconds);

  // Always keep the "current week" key updated.
  await writeCurrentWeek(redis, meta);

  // The week(s) that just finished
  const targetWeek = meta.weekIndex - 1;
  if (targetWeek < 0) {
    return { ok: true, currentWeekIndex: meta.weekIndex, snappedWeeks: [] };
  }

  const lastSnap = Number((await redis.get<number | string>(KEYS.weeklyLastSnapWeek)) ?? -1);
  const snapped: number[] = [];

  for (let w = lastSnap + 1; w <= targetWeek; w++) {
    const raw = (await redis.zrange(KEYS.weeklyZ(w), 0, 99, { rev: true, withScores: true })) as Array<
      string | number
    >;

    const top100: Array<{ address: string; bestScore: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      const address = String(raw[i] ?? "");
      const bestScore = Number(raw[i + 1] ?? 0);
      if (address) top100.push({ address, bestScore });
    }

    const { start, end } = getWeekBounds(epochSeconds, w);

    const payload = {
      weekIndex: w,
      createdAt: new Date().toISOString(),
      weekStartsAt: new Date(start * 1000).toISOString(),
      weekEndsAt: new Date(end * 1000).toISOString(),
      chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 8453),
      contract: process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS ?? null,
      top100,
    };

    const key = KEYS.weeklySnapshotKey(w);
    await redis.set(key, payload);
    await redis.lpush(KEYS.weeklySnapshots, key);
    await redis.set(KEYS.weeklyLastSnapWeek, String(w));

    snapped.push(w);
  }

  return { ok: true, currentWeekIndex: meta.weekIndex, snappedWeeks: snapped };
}

export async function runLeaderboardMaintenance(
  redis: Redis,
  opts?: { maxBlocksAllTime?: bigint; maxBlocksWeekly?: bigint }
) {
  const allTime = await syncAllTimeLeaderboard(redis, {
    maxBlocks: opts?.maxBlocksAllTime,
  });
  const weekly = await syncWeeklyLeaderboard(redis, {
    maxBlocks: opts?.maxBlocksWeekly,
  });
  const snapshots = await snapshotCompletedWeeks(redis);
  return { allTime, weekly, snapshots };
}
