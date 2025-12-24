import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import type { EIP1193Provider } from "./types";

const abi = parseAbi([
  "function best(address) view returns (uint32)",
  "function submitScore(uint32 score)",
]);

export async function getBestScore(params: {
  provider: EIP1193Provider;
  contract: `0x${string}`;
  address: `0x${string}`;
}): Promise<number> {
  const data = encodeFunctionData({
    abi,
    functionName: "best",
    args: [params.address],
  });

  const res = (await params.provider.request({
    method: "eth_call",
    params: [{ to: params.contract, data }, "latest"],
  })) as string;

  const decoded = decodeFunctionResult({
    abi,
    functionName: "best",
    data: res as `0x${string}`,
  });

  return Number(decoded);
}

export async function submitScore(params: {
  provider: EIP1193Provider;
  contract: `0x${string}`;
  from: `0x${string}`;
  score: number;
}): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi,
    functionName: "submitScore",
    args: [params.score],
  });

  const txHash = (await params.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: params.from,
        to: params.contract,
        data,
        value: "0x0",
      },
    ],
  })) as `0x${string}`;

  return txHash;
}

export async function waitForReceipt(params: {
  provider: EIP1193Provider;
  txHash: `0x${string}`;
  timeoutMs?: number;
}) {
  const timeoutMs = params.timeoutMs ?? 60_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = await params.provider.request({
      method: "eth_getTransactionReceipt",
      params: [params.txHash],
    });
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("Timed out waiting for transaction receipt.");
}
