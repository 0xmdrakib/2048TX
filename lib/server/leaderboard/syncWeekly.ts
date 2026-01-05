import "server-only";

import type { Redis } from "@upstash/redis";
import { publicClient, scoreSubmittedEvent } from "../chainClient";
import { KEYS } from "./store";
import { getOrInitWeeklyEpoch, getWeekIndex } from "./weeklySeason";

// How many blocks to query per getLogs call (keeps RPC happy).
const CHUNK = 2000n;

export type SyncResult = {
  ok: boolean;
  error?: string;
  contract: string;
  fromBlock: bigint;
  toBlock: bigint;
  logsProcessed: number;
  usersTouched: number;
  epochSeconds: number;
};

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<void>
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (let i = 0; i < items.length; i++) {
    const p = fn(items[i], i);
    executing.add(p);
    const cleanup = () => executing.delete(p);
    p.then(cleanup, cleanup);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

async function warmBlockTimestampCache(blockNumbers: bigint[], cache: Map<string, number>) {
  const missing: bigint[] = [];
  for (const bn of blockNumbers) {
    const k = bn.toString();
    if (!cache.has(k)) missing.push(bn);
  }
  if (!missing.length) return;

  // Keep concurrency modest to avoid RPC rate-limits.
  const CONCURRENCY = 8;

  await mapLimit(missing, CONCURRENCY, async (bn) => {
    const block = await publicClient.getBlock({ blockNumber: bn });
    cache.set(bn.toString(), Number(block.timestamp));
  });
}

export async function syncWeeklyLeaderboard(redis: Redis, opts?: { maxBlocks?: bigint }): Promise<SyncResult> {
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
      epochSeconds: 0,
    };
  }

  const epochSeconds = await getOrInitWeeklyEpoch(redis);
  const latest = await publicClient.getBlockNumber();

  const last = await redis.get<number | string>(KEYS.weeklyLastBlock);
  // First run: start counting from "now" (latest block) by default.
  // This matches your requirement: weekly leaderboard starts when you enable it.
  if (last === null || last === undefined) {
    await redis.set(KEYS.weeklyLastBlock, String(latest));
    return {
      ok: true,
      contract,
      fromBlock: latest,
      toBlock: latest,
      logsProcessed: 0,
      usersTouched: 0,
      epochSeconds,
    };
  }

  let fromBlock = BigInt(last) + 1n;
  let toBlock = latest;

  if (opts?.maxBlocks && opts.maxBlocks > 0n) {
    const maxTo = fromBlock + opts.maxBlocks - 1n;
    if (maxTo < toBlock) toBlock = maxTo;
  }

  if (fromBlock > toBlock) {
    return {
      ok: true,
      contract,
      fromBlock,
      toBlock,
      logsProcessed: 0,
      usersTouched: 0,
      epochSeconds,
    };
  }

  let logsProcessed = 0;
  const touched = new Set<string>();
  const blockTsCache = new Map<string, number>();

  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = start + CHUNK - 1n > toBlock ? toBlock : start + CHUNK - 1n;

    const logs = await publicClient.getLogs({
      address: contract as `0x${string}`,
      event: scoreSubmittedEvent,
      fromBlock: start,
      toBlock: end,
    });

    if (logs.length) {
      // Warm timestamp cache for this batch so the per-log loop has zero awaits.
      const uniqueBlocks = Array.from(
        new Set((logs as any[]).map((l) => String(l.blockNumber)))
      ).map((s) => BigInt(s));

      await warmBlockTimestampCache(uniqueBlocks, blockTsCache);

      const pipeline = redis.pipeline();

      for (const log of logs as any[]) {
        const player = (String(log.args.player) as string).toLowerCase();
        const score = Number(log.args.score);

        const bn = log.blockNumber as bigint;
        const ts = blockTsCache.get(bn.toString());
        if (!ts) continue;

        const weekIndex = getWeekIndex(epochSeconds, ts);
        if (weekIndex < 0) continue; // ignore events before weekly epoch

        (pipeline as any).zadd(KEYS.weeklyZ(weekIndex), { gt: true }, { score, member: player });
        touched.add(player);
      }

      await pipeline.exec();
      logsProcessed += logs.length;
    }

    await redis.set(KEYS.weeklyLastBlock, String(end));
  }

  return {
    ok: true,
    contract,
    fromBlock,
    toBlock,
    logsProcessed,
    usersTouched: touched.size,
    epochSeconds,
  };
}
