import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { appendErc8021Suffix } from "./builderCodes";
import type { EIP1193Provider } from "./types";
import { getWalletCallSupport, sendSponsoredCallsAndGetTxHash } from "./gasless";

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
    res = (await requestWithTimeout(
      params.provider.request({
        method: "eth_call",
        params: [{ to: params.contract, data }, "latest"],
      }) as Promise<string>,
      5_000,
    )) as string;
  } catch (e) {
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
      5_000,
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

  const paymasterProxyUrl = process.env.NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL;

  // Primary path: wallet-native EIP-5792 + ERC-7677 sponsorship.
  // This is the safest MetaMask same-address route because MetaMask itself handles
  // the smart-account upgrade / smart execution when the wallet reports support.
  if (paymasterProxyUrl) {
    const chainIdHex = (await params.provider.request({
      method: "eth_chainId",
      params: [],
    })) as `0x${string}`;

    const support = await getWalletCallSupport({
      provider: params.provider,
      from: params.from,
      chainIdHex,
    });

    if (support.paymasterSupported) {
      return await sendSponsoredCallsAndGetTxHash({
        provider: params.provider,
        chainIdHex,
        from: params.from,
        calls: [{ to: params.contract, value: "0x0", data }],
      });
    }
  }

  // Secondary path: if we're inside a Base App / wallet webview, there may be a second
  // injected provider on window.ethereum that supports wallet_sendCalls for the same account.
  try {
    if (typeof window !== "undefined") {
      const eth = (window as any)?.ethereum as EIP1193Provider | undefined;

      if (eth && eth !== params.provider && typeof (eth as any).request === "function") {
        const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
        const hasSameAccount =
          Array.isArray(accounts) &&
          accounts.some((a) => a?.toLowerCase?.() === params.from.toLowerCase());

        if (hasSameAccount && paymasterProxyUrl) {
          const chainIdHex = (await eth.request({
            method: "eth_chainId",
            params: [],
          })) as `0x${string}`;

          const support = await getWalletCallSupport({
            provider: eth,
            from: params.from,
            chainIdHex,
          });

          if (support.paymasterSupported) {
            return await sendSponsoredCallsAndGetTxHash({
              provider: eth,
              chainIdHex,
              from: params.from,
              calls: [{ to: params.contract, value: "0x0", data }],
            });
          }
        }
      }
    }
  } catch {
    // ignore and fall back to normal tx
  }

  // Fallback: normal EOA tx (costs gas).
  const txHash = (await params.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: params.from,
        to: params.contract,
        data: appendErc8021Suffix(data),
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
    let receipt: any = null;

    try {
      receipt = await params.provider.request({
        method: "eth_getTransactionReceipt",
        params: [params.txHash],
      });
    } catch (e) {
      if (!methodUnsupported(e)) throw e;
    }
    if (receipt) return receipt;

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
