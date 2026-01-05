import { NextRequest, NextResponse } from "next/server";
import { decodeEventLog } from "viem";

import { KEYS, getRedis } from "@/lib/server/leaderboard/store";
import {
  getOrInitWeeklyEpoch,
  getWeekIndex,
  getWeekMeta,
} from "@/lib/server/leaderboard/weeklySeason";
import { snapshotCompletedWeeks } from "@/lib/server/leaderboard/maintenance";
import { publicClient, scoreSubmittedEvent } from "@/lib/server/chainClient";
import { syncWeeklyLeaderboard } from "@/lib/server/leaderboard/syncWeekly";

type Entry = { address: string; bestScore: number };

type IngestBody = { txHash?: string };

export const dynamic = "force-dynamic";

function json(data: any, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  // Avoid stale CDN/browser caching; this endpoint is meant to be "live".
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function isTxHash(x: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(x);
}

async function setMaxBlock(redis: any, key: string, bn: bigint) {
  const cur = await redis.get<number | string>(key);
  const curBn = cur !== null && cur !== undefined ? BigInt(cur) : 0n;
  if (bn > curBn) await redis.set(key, bn.toString());
}

export async function GET(req: NextRequest) {
  const contract = process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS ?? null;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 8453);

  const redis = getRedis();
  if (!redis) {
    return json(
      {
        ok: false,
        error: "Leaderboard storage not configured. Add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.",
      },
      { status: 500 }
    );
  }

  // OPTIONAL: Public "refresh" (manual repair). Kept for debugging.
  // This scans a small block window, so it's not a replacement for a scheduler.
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  if (refresh) {
    const now = Date.now();
    const last = Number((await redis.get<number | string>(KEYS.weeklyLastPublicSyncAt)) ?? 0);
    if (!last || now - last > 20_000) {
      await redis.set(KEYS.weeklyLastPublicSyncAt, String(now));
      await syncWeeklyLeaderboard(redis, { maxBlocks: 2000n });
    }
  }

  // Throttled snapshot check (so week rollover snapshots happen without QStash/Cron)
  {
    const now = Date.now();
    const lastCheck = Number((await redis.get<number | string>(KEYS.weeklyLastSnapshotCheckAt)) ?? 0);
    if (!lastCheck || now - lastCheck > 5 * 60_000) {
      await redis.set(KEYS.weeklyLastSnapshotCheckAt, String(now));
      // If a week finished and nobody ran a scheduler, this will finalize it.
      await snapshotCompletedWeeks(redis);
    }
  }

  const epochSeconds = await getOrInitWeeklyEpoch(redis);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const meta = getWeekMeta(epochSeconds, nowSeconds);

  // Keep a human-friendly "current week" key in Redis (visible in Upstash Data Browser)
  await redis.set(KEYS.weeklyCurrent, {
    weekIndex: meta.weekIndex,
    weekStartsAt: new Date(meta.weekStartSeconds * 1000).toISOString(),
    weekEndsAt: new Date(meta.weekEndSeconds * 1000).toISOString(),
    secondsLeft: meta.secondsLeft,
    updatedAt: Date.now(),
  });

  const weekKey = KEYS.weeklyZ(meta.weekIndex);

  const raw = (await redis.zrange(weekKey, 0, 99, { rev: true, withScores: true })) as Array<
    string | number
  >;

  const top100: Entry[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const address = String(raw[i] ?? "");
    const bestScore = Number(raw[i + 1] ?? 0);
    if (address) top100.push({ address, bestScore });
  }

  const lastBlock = (await redis.get<number | string>(KEYS.weeklyLastBlock)) ?? null;

  return json({
    ok: true,
    scope: "weekly",
    chainId,
    contract,
    weekIndex: meta.weekIndex,
    weekStartsAt: new Date(meta.weekStartSeconds * 1000).toISOString(),
    weekEndsAt: new Date(meta.weekEndSeconds * 1000).toISOString(),
    secondsLeft: meta.secondsLeft,
    updatedFromBlock: lastBlock,
    top100,
  });
}

/**
 * Push-based ingestion (DriftWing-style):
 * The client calls this after a score tx is confirmed.
 * No QStash needed for "live" updates.
 */
export async function POST(req: NextRequest) {
  const contract = process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 8453);
  if (!contract) {
    return json({ ok: false, error: "Missing NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS" }, { status: 500 });
  }

  const redis = getRedis();
  if (!redis) {
    return json(
      {
        ok: false,
        error: "Leaderboard storage not configured. Add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.",
      },
      { status: 500 }
    );
  }

  let body: IngestBody | null = null;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    body = null;
  }

  const txHash = String(body?.txHash ?? "");
  if (!isTxHash(txHash)) return json({ ok: false, error: "Invalid txHash" }, { status: 400 });

  // Idempotency: avoid repeated RPC work for the same txHash
  const ingestedKey = `lb:ingest:tx:${txHash}`;
  const already = await redis.get<number | string>(ingestedKey);
  if (already) {
    return json({ ok: true, mode: "push", status: "already_ingested", txHash });
  }

  let receipt: any;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    // Pending/not found yet.
    return json({ ok: false, status: "pending", message: "Tx not found yet" }, { status: 202 });
  }

  if (!receipt || receipt.status !== "success") {
    return json({ ok: false, error: "Transaction failed" }, { status: 400 });
  }

  // Decode the ScoreSubmitted event from this tx
  let player: string | null = null;
  let bestScore: number | null = null;

  for (const log of receipt.logs || []) {
    if (!log?.address) continue;
    if (String(log.address).toLowerCase() !== String(contract).toLowerCase()) continue;

    try {
      const decoded = decodeEventLog({
        abi: [scoreSubmittedEvent],
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === "ScoreSubmitted") {
        const args: any = decoded.args;
        player = String(args.player);
        bestScore = Number(args.bestScore);
        break;
      }
    } catch {
      // ignore
    }
  }

  if (!player || bestScore == null) {
    return json({ ok: false, error: "No ScoreSubmitted event found in tx" }, { status: 400 });
  }

  // Block timestamp -> week placement
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const tsSeconds = Number(block.timestamp);

  const epochSeconds = await getOrInitWeeklyEpoch(redis);
  const weekIndex = Math.max(0, getWeekIndex(epochSeconds, tsSeconds));

  const member = player.toLowerCase();

  // Update weekly + all-time leaderboards
  const pipe = redis.pipeline();
  pipe.zadd(KEYS.weeklyZ(weekIndex), { score: bestScore, member });
  pipe.zadd(KEYS.z, { score: bestScore, member });
  await pipe.exec();

  // Maintain last processed blocks (useful for optional repair sync)
  await setMaxBlock(redis, KEYS.weeklyLastBlock, receipt.blockNumber);
  await setMaxBlock(redis, KEYS.lastBlock, receipt.blockNumber);

  // Mark this tx as ingested (30 days)
  try {
    await (redis as any).set(ingestedKey, "1", { ex: 60 * 60 * 24 * 30 });
  } catch {
    // ignore
  }

  // Finalize any weeks that ended since last time
  const snapshots = await snapshotCompletedWeeks(redis);

  // Update the "current week" convenience key after ingestion too
  {
    const nowSeconds2 = Math.floor(Date.now() / 1000);
    const meta2 = getWeekMeta(epochSeconds, nowSeconds2);
    await redis.set(KEYS.weeklyCurrent, {
      weekIndex: meta2.weekIndex,
      weekStartsAt: new Date(meta2.weekStartSeconds * 1000).toISOString(),
      weekEndsAt: new Date(meta2.weekEndSeconds * 1000).toISOString(),
      secondsLeft: meta2.secondsLeft,
      updatedAt: Date.now(),
    });
  }


  return json({
    ok: true,
    mode: "push",
    chainId,
    contract,
    weekIndex,
    player: member,
    bestScore,
    txHash,
    blockNumber: receipt.blockNumber?.toString?.() ?? String(receipt.blockNumber),
    blockTimestamp: tsSeconds,
    snapshots,
  });
}
