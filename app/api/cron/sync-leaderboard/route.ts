import { NextRequest, NextResponse } from "next/server";
import { publicClient, scoreSubmittedEvent } from "@/lib/server/chainClient";
import { KEYS, getRedis } from "@/lib/server/leaderboardStore";

export const dynamic = "force-dynamic";

// How many blocks to query per getLogs call (keeps RPC happy).
const CHUNK = 2000n;

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  // Vercel Cron Jobs: if you set CRON_SECRET as an env var in the Vercel project,
  // Vercel will automatically include it as an Authorization Bearer token.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) return unauthorized();

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      {
        ok: false,
        error: "Upstash Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
      },
      { status: 500 }
    );
  }

  const contract = process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!contract) {
    return NextResponse.json({ ok: false, error: "Missing NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS" }, { status: 500 });
  }

  const deployBlock = BigInt(process.env.SCORE_CONTRACT_DEPLOY_BLOCK ?? "0");
  const last = await redis.get<string>(KEYS.lastBlock);
  let fromBlock = last ? BigInt(last) + 1n : deployBlock;

  const toBlock = await publicClient.getBlockNumber();
  if (fromBlock > toBlock) {
    return NextResponse.json({ ok: true, message: "No new blocks", fromBlock: String(fromBlock), toBlock: String(toBlock) });
  }

  let logsProcessed = 0;
  const touched = new Set<string>();

  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = start + CHUNK - 1n > toBlock ? toBlock : start + CHUNK - 1n;

    const logs = await publicClient.getLogs({
      address: contract,
      event: scoreSubmittedEvent,
      fromBlock: start,
      toBlock: end,
    });

    if (logs.length) {
      const pipeline = redis.pipeline();
      for (const log of logs) {
        const player = (log.args.player as string).toLowerCase();
        const bestScore = Number(log.args.bestScore);
        pipeline.zadd(KEYS.z, { score: bestScore, member: player });
        touched.add(player);
      }
      await pipeline.exec();
      logsProcessed += logs.length;
    }

    await redis.set(KEYS.lastBlock, String(end));
  }

  return NextResponse.json({
    ok: true,
    contract,
    fromBlock: String(fromBlock),
    toBlock: String(toBlock),
    logsProcessed,
    usersTouched: touched.size,
  });
}
