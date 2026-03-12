import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { appendErc8021Suffix } from "./builderCodes";
import type { EIP1193Provider } from "./types";
import { supportsPaymaster, sendSponsoredCallsAndGetTxHash } from "./gasless";

const abi = parseAbi([
  "function best(address) view returns (uint32)",
  "function submissions(address) view returns (uint64)",
  "function lastScore(address) view returns (uint32)",
  "function submitScore(uint32 score)",
]);

type JsonRpcError = { code?: number; message?: string };
type Address = `0x${string}`;
type TxHash = `0x${string}`;

type SmartAccountBundle = {
  account: any;
  bundlerClient: {
    sendUserOperation: (args: {
      account: unknown;
      calls: Array<{ to: Address; data: `0x${string}`; value: bigint }>;
      paymaster?: boolean;
    }) => Promise<`0x${string}`>;
    waitForUserOperationReceipt: (args: { hash: `0x${string}` }) => Promise<any>;
  };
};

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

function getRpcUrl(chainIdDec: number) {
  if (process.env.NEXT_PUBLIC_BASE_RPC_URL) return process.env.NEXT_PUBLIC_BASE_RPC_URL;
  return chainIdDec === 84532 ? "https://sepolia.base.org" : "https://mainnet.base.org";
}

function getBundlerProxyUrl() {
  return process.env.NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL || null;
}

async function getChainIdDec(provider: EIP1193Provider) {
  const chainIdHex = (await provider.request({
    method: "eth_chainId",
    params: [],
  })) as `0x${string}`;

  return Number.parseInt(chainIdHex, 16);
}

async function getBaseChain(chainIdDec: number) {
  const { base, baseSepolia } = await import("viem/chains");
  return chainIdDec === 84532 ? baseSepolia : base;
}

async function get4337Bundle(params: {
  provider: EIP1193Provider;
  chainIdDec: number;
}): Promise<SmartAccountBundle | null> {
  const bundlerUrl = getBundlerProxyUrl();
  if (!bundlerUrl) return null;

  const [{ createPublicClient, http }, { createBundlerClient }, { toSimpleSmartAccount }] =
    await Promise.all([
      import("viem"),
      import("viem/account-abstraction"),
      import("permissionless/accounts"),
    ]);

  const chain = await getBaseChain(params.chainIdDec);

  const client = createPublicClient({
    chain,
    transport: http(getRpcUrl(params.chainIdDec)),
  });

  const account = await toSimpleSmartAccount({
    client,
    owner: params.provider as any,
  });

  const bundlerClient = createBundlerClient({
    account,
    client,
    chain,
    transport: http(bundlerUrl),
    paymaster: true,
  });

  return {
    account,
    bundlerClient: bundlerClient as SmartAccountBundle["bundlerClient"],
  };
}

async function supportsAlternateWindowPaymaster(params: {
  provider: EIP1193Provider;
  from: Address;
}) {
  if (typeof window === "undefined") return null;

  const eth = (window as any)?.ethereum as EIP1193Provider | undefined;
  if (!eth || eth === params.provider || typeof (eth as any).request !== "function") return null;

  const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
  const hasSameAccount =
    Array.isArray(accounts) &&
    accounts.some((a) => a?.toLowerCase?.() === params.from.toLowerCase());

  if (!hasSameAccount) return null;

  const chainIdHex = (await eth.request({
    method: "eth_chainId",
    params: [],
  })) as `0x${string}`;

  const canSponsor = await supportsPaymaster({
    provider: eth,
    from: params.from,
    chainIdHex,
  });

  if (!canSponsor) return null;

  return { provider: eth, chainIdHex };
}

export async function resolveScoreAddress(params: {
  provider: EIP1193Provider;
  eoaAddress: Address;
  chainIdDec?: number;
}): Promise<Address> {
  const bundlerUrl = getBundlerProxyUrl();
  if (!bundlerUrl) return params.eoaAddress;

  const chainIdDec = params.chainIdDec ?? (await getChainIdDec(params.provider));
  const chainIdHex = `0x${chainIdDec.toString(16)}` as `0x${string}`;

  try {
    const canSponsor = await supportsPaymaster({
      provider: params.provider,
      from: params.eoaAddress,
      chainIdHex,
    });
    if (canSponsor) return params.eoaAddress;
  } catch {
    // ignore and continue
  }

  try {
    const alt = await supportsAlternateWindowPaymaster({
      provider: params.provider,
      from: params.eoaAddress,
    });
    if (alt) return params.eoaAddress;
  } catch {
    // ignore and continue
  }

  try {
    const bundle = await get4337Bundle({ provider: params.provider, chainIdDec });
    if (bundle?.account?.address) return bundle.account.address;
  } catch {
    // if account derivation fails, keep using the connected EOA for reads
  }

  return params.eoaAddress;
}

export async function getBestScore(params: {
  provider: EIP1193Provider;
  contract: Address;
  address: Address;
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
  contract: Address;
  address: Address;
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
  contract: Address;
  from: Address;
  score: number;
}): Promise<TxHash> {
  const data = encodeFunctionData({
    abi,
    functionName: "submitScore",
    args: [params.score],
  });

  const paymasterProxyUrl = getBundlerProxyUrl();
  if (paymasterProxyUrl) {
    const chainIdDec = await getChainIdDec(params.provider);
    const chainIdHex = `0x${chainIdDec.toString(16)}` as `0x${string}`;

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

    try {
      const alt = await supportsAlternateWindowPaymaster({
        provider: params.provider,
        from: params.from,
      });

      if (alt && paymasterProxyUrl) {
        return await sendSponsoredCallsAndGetTxHash({
          provider: alt.provider,
          chainIdHex: alt.chainIdHex,
          from: params.from,
          calls: [{ to: params.contract, value: "0x0", data }],
        });
      }
    } catch {
      // ignore and continue to 4337 fallback
    }

    try {
      const bundle = await get4337Bundle({
        provider: params.provider,
        chainIdDec,
      });

      if (bundle) {
        const userOpHash = await bundle.bundlerClient.sendUserOperation({
          account: bundle.account,
          calls: [
            {
              to: params.contract,
              data: appendErc8021Suffix(data),
              value: 0n,
            },
          ],
          paymaster: true,
        });

        const receipt = await bundle.bundlerClient.waitForUserOperationReceipt({
          hash: userOpHash,
        });

        const txHash =
          receipt?.receipt?.transactionHash ??
          receipt?.transactionHash ??
          receipt?.userOperationReceipt?.receipt?.transactionHash;

        if (!txHash || typeof txHash !== "string") {
          throw new Error("Sponsored UserOperation finished without a transaction hash.");
        }

        return txHash as TxHash;
      }
    } catch (e: any) {
      throw new Error(e?.message ?? "Gasless score save failed.");
    }
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
  })) as TxHash;

  return txHash;
}

export async function waitForReceipt(params: {
  provider: EIP1193Provider;
  txHash: TxHash;
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
