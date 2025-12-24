import { encodeFunctionData, parseAbi } from "viem";
import type { EIP1193Provider } from "./types";

// Native USDC on Base mainnet (decimals = 6)
// Source: Circle (native USDC on Base)
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const erc20Abi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

export async function sendUsdcTransfer(params: {
  provider: EIP1193Provider;
  from: `0x${string}`;
  to: `0x${string}`;
  /** USDC smallest units (6 decimals). For 0.000001 -> pass 1. */
  amountUnits: bigint;
}): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [params.to, params.amountUnits],
  });

  const txHash = (await params.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: params.from,
        to: BASE_USDC_ADDRESS,
        data,
        value: "0x0",
      },
    ],
  })) as `0x${string}`;

  return txHash;
}
