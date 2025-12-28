import "server-only";

import { createPublicClient, http, parseAbiItem } from "viem";
import { base, baseSepolia } from "viem/chains";

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 8453);
const rpcUrl =
  process.env.NEXT_PUBLIC_BASE_RPC_URL ??
  (chainId === 84532 ? "https://sepolia.base.org" : "https://mainnet.base.org");

export const publicClient = createPublicClient({
  chain: chainId === 84532 ? baseSepolia : base,
  transport: http(rpcUrl),
});

// Score2048.sol event
export const scoreSubmittedEvent = parseAbiItem(
  "event ScoreSubmitted(address indexed player, uint32 score, uint32 bestScore, uint64 submissionIndex)"
);
