import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import type { EIP1193Provider } from "./types";

const abi = parseAbi([
  "function best(address) view returns (uint32)",
  "function submitScore(uint32 score)",
]);

type JsonRpcError = { code?: number; message?: string };

function methodUnsupported(e: unknown) {
  const err = e as JsonRpcError;
  const msg = String(err?.message ?? e);
  return err?.code === -32601 || /does not support|not support|Method not found/i.test(msg);
}

async function rpcRequest(method: string, params: any[] = []) {
  const url = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error?.message || "RPC error");
  }
  return json.result;
}

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

  let res: string;
  try {
    res = (await params.provider.request({
      method: "eth_call",
      params: [{ to: params.contract, data }, "latest"],
    })) as string;
  } catch (e) {
    // Some embedded providers don't implement the full JSON-RPC surface.
    if (!methodUnsupported(e)) throw e;
    res = (await rpcRequest("eth_call", [{ to: params.contract, data }, "latest"])) as string;
  }

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
    // NOTE:
    // Some embedded wallet providers (notably in-app smart wallets) may *support*
    // eth_getTransactionReceipt but keep returning `null` even after the tx is mined.
    // In those cases, querying a public RPC is more reliable.
    let receipt: any = null;

    // 1) Try via the provider first.
    try {
      receipt = await params.provider.request({
        method: "eth_getTransactionReceipt",
        params: [params.txHash],
      });
    } catch (e) {
      if (!methodUnsupported(e)) throw e;
      // If the method is missing, we'll fall back to RPC below.
    }
    if (receipt) return receipt;

    // 2) Always attempt via RPC as a fallback (even if provider returned null).
    try {
      receipt = await rpcRequest("eth_getTransactionReceipt", [params.txHash]);
    } catch {
      // ignore and keep polling
    }
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("Timed out waiting for transaction receipt.");
}
