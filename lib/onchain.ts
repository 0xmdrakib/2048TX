import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import { createBundlerClient } from "viem/account-abstraction";
import { base, baseSepolia } from "viem/chains";
import { appendErc8021Suffix } from "./builderCodes";
import type { EIP1193Provider } from "./types";
import {
  getAtomicCapabilityStatus,
  sendAtomicCallsAndGetTxHash,
  sendSponsoredCallsAndGetTxHash,
  supportsPaymaster,
} from "./gasless";

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

function isMetaMaskProvider(provider: EIP1193Provider): boolean {
  return Boolean((provider as any)?.isMetaMask);
}

function getConfiguredChain() {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "8453");
  if (chainId === 84532) return baseSepolia;
  return base;
}

function resolveBundlerUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window !== "undefined") return new URL(url, window.location.origin).toString();
  return url;
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

async function getAccountCode(params: {
  provider: EIP1193Provider;
  address: `0x${string}`;
}): Promise<`0x${string}`> {
  try {
    return (await params.provider.request({
      method: "eth_getCode",
      params: [params.address, "latest"],
    })) as `0x${string}`;
  } catch (e) {
    if (!methodUnsupported(e)) throw e;
    return (await rpcRequest("eth_getCode", [params.address, "latest"])) as `0x${string}`;
  }
}

async function sendMetaMask7702SponsoredScore(params: {
  provider: EIP1193Provider;
  chainIdHex: `0x${string}`;
  contract: `0x${string}`;
  from: `0x${string}`;
  data: `0x${string}`;
}): Promise<`0x${string}`> {
  const bundlerUrlRaw = process.env.NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL;
  if (!bundlerUrlRaw) throw new Error("Missing NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL");
  const bundlerUrl = resolveBundlerUrl(bundlerUrlRaw);

  const chain = getConfiguredChain();
  const publicClient = createPublicClient({
    chain,
    transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || undefined),
  });

  const walletClient = createWalletClient({
    chain,
    transport: custom(params.provider as any),
  });

  const [{ Implementation, toMetaMaskSmartAccount }, addresses] = await Promise.all([
    import("@metamask/smart-accounts-kit"),
    walletClient.getAddresses(),
  ]);

  const address = (addresses?.[0] ?? params.from) as `0x${string}`;

  const account = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Stateless7702,
    address,
    signer: { walletClient },
  });

  const bundlerClient = createBundlerClient({
    account,
    client: publicClient,
    transport: http(bundlerUrl),
  });

  const userOperationHash = await bundlerClient.sendUserOperation({
    account,
    calls: [{ to: params.contract, value: 0n, data: appendErc8021Suffix(params.data) }],
    paymaster: true,
  });

  const receipt: any = await bundlerClient.waitForUserOperationReceipt({
    hash: userOperationHash,
    timeout: 120_000,
    pollingInterval: 1_200,
  });

  const txHash = receipt?.receipt?.transactionHash ?? receipt?.transactionHash;
  if (!txHash) throw new Error("No transaction hash found for sponsored user operation");
  return txHash as `0x${string}`;
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
      5_000
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

  const paymasterProxyUrl = process.env.NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL;
  if (paymasterProxyUrl) {
    const chainIdHex = (await params.provider.request({
      method: "eth_chainId",
      params: [],
    })) as `0x${string}`;

    const canSponsor = await supportsPaymaster({
      provider: params.provider,
      from: params.from,
      chainIdHex,
    });

    if (canSponsor) {
      return await sendSponsoredCallsAndGetTxHash({
        provider: params.provider,
        chainIdHex,
        from: params.from,
        calls: [{ to: params.contract, value: "0x0", data }],
      });
    }

    if (isMetaMaskProvider(params.provider)) {
      const atomicStatus = await getAtomicCapabilityStatus({
        provider: params.provider,
        from: params.from,
        chainIdHex,
      });
      const atomicCapable = atomicStatus === "ready" || atomicStatus === "supported";

      const code = await getAccountCode({ provider: params.provider, address: params.from });

      if (code && code !== "0x" && atomicCapable) {
        return await sendMetaMask7702SponsoredScore({
          provider: params.provider,
          chainIdHex,
          contract: params.contract,
          from: params.from,
          data,
        });
      }

      if (atomicCapable) {
        return await sendAtomicCallsAndGetTxHash({
          provider: params.provider,
          chainIdHex,
          from: params.from,
          calls: [{ to: params.contract, value: "0x0", data }],
        });
      }
    }
  }

  try {
    if (typeof window !== "undefined") {
      const eth = (window as any)?.ethereum as EIP1193Provider | undefined;

      if (eth && eth !== params.provider && typeof (eth as any).request === "function") {
        const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
        const hasSameAccount =
          Array.isArray(accounts) &&
          accounts.some((a) => a?.toLowerCase?.() === params.from.toLowerCase());

        if (hasSameAccount) {
          const chainIdHex = (await eth.request({
            method: "eth_chainId",
            params: [],
          })) as `0x${string}`;

          const canSponsor = await supportsPaymaster({
            provider: eth,
            from: params.from,
            chainIdHex,
          });

          if (canSponsor && process.env.NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL) {
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
