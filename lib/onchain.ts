import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import type { EIP1193Provider } from "./types";
import { supportsPaymaster, sendSponsoredCallsAndGetTxHash } from "./gasless";

const abi = parseAbi([
  "function best(address) view returns (uint32)",
  "function submissions(address) view returns (uint64)",
  "function lastScore(address) view returns (uint32)",
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

async function requestWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("RPC request timed out")), ms);
    }),
  ]);
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
    // Some embedded providers may hang (resolve very slowly) on eth_call.
    // We apply a short timeout and fall back to a public RPC.
    res = (await requestWithTimeout(
      params.provider.request({
        method: "eth_call",
        params: [{ to: params.contract, data }, "latest"],
      }) as Promise<string>,
      5_000
    )) as string;
  } catch (e) {
    // Some embedded providers don't implement the full JSON-RPC surface.
    // If the method is unsupported OR the call timed out, fall back to RPC.
    if (!methodUnsupported(e) && !/timed out/i.test(String((e as any)?.message ?? e))) throw e;
    res = (await rpcRequest("eth_call", [{ to: params.contract, data }, "latest"])) as string;
  }

  const decoded = decodeFunctionResult({
    abi,
    functionName: "best",
    data: res as `0x${string}`,
  });

  return Number(decoded);
}

export async function getSubmissions(params: {
  provider: EIP1193Provider;
  contract: `0x${string}`;
  address: `0x${string}`;
}): Promise<number> {
  const data = encodeFunctionData({
    abi,
    functionName: "submissions",
    args: [params.address],
  });

  let res: string;
  try {
    res = (await requestWithTimeout(
      params.provider.request({
        method: "eth_call",
        params: [{ to: params.contract, data }, "latest"],
      }) as Promise<string>,
      5_000
    )) as string;
  } catch (e) {
    if (!methodUnsupported(e) && !/timed out/i.test(String((e as any)?.message ?? e))) throw e;
    res = (await rpcRequest("eth_call", [{ to: params.contract, data }, "latest"])) as string;
  }

  const decoded = decodeFunctionResult({
    abi,
    functionName: "submissions",
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

  // Try sponsored path first (only if wallet supports it)
  try {
    const chainIdHex = (await params.provider.request({
      method: "eth_chainId",
      params: [],
    })) as `0x${string}`;

    const canSponsor = await supportsPaymaster({
      provider: params.provider,
      from: params.from,
      chainIdHex,
    });

    if (canSponsor && process.env.NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL) {
      return await sendSponsoredCallsAndGetTxHash({
        provider: params.provider,
        chainIdHex,
        from: params.from,
        calls: [{ to: params.contract, value: "0x0", data }],
      });
    }
  } catch {
    // If anything fails here, we fall back to normal tx below.
  }

  // Fallback: normal EOA-style tx
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
