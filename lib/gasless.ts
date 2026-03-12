import type { EIP1193Provider } from "./types";
import { appendErc8021Suffix } from "./builderCodes";

type JsonRpcError = { code?: number; message?: string };

type AtomicCapabilityStatus = "supported" | "ready" | null;

function isUserRejected(e: unknown): boolean {
  const err = e as any;
  const code = err?.code ?? err?.data?.code;
  if (code === 4001) return true; // EIP-1193 userRejectedRequest
  const msg = String(err?.message ?? e);
  return /user rejected|rejected the request|request rejected|cancelled|canceled/i.test(msg);
}

function isInvalidParams(e: unknown): boolean {
  const err = e as JsonRpcError;
  const msg = String(err?.message ?? e);
  return err?.code === -32602 || /invalid params|invalid argument|version|atomicRequired/i.test(msg);
}

function methodUnsupported(e: unknown) {
  const err = e as JsonRpcError;
  const msg = String(err?.message ?? e);
  return err?.code === -32601 || /does not support|not support|Method not found/i.test(msg);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getCapabilities(params: {
  provider: EIP1193Provider;
  from: `0x${string}`;
  chainIdHex: `0x${string}`;
}): Promise<any | null> {
  let caps: any = null;

  try {
    caps = (await params.provider.request({
      method: "wallet_getCapabilities",
      // MetaMask docs show [address, [chainIds]]. Some wallets ignore the 2nd arg.
      params: [params.from, [params.chainIdHex]],
    })) as any;
  } catch (e) {
    if (methodUnsupported(e)) return null;
    try {
      caps = (await params.provider.request({
        method: "wallet_getCapabilities",
        params: [params.from],
      })) as any;
    } catch (e2) {
      if (methodUnsupported(e2)) return null;
      return null;
    }
  }

  const chainIdDec = Number.parseInt(params.chainIdHex, 16);
  const byHex = caps?.[params.chainIdHex];
  const byDec = caps?.[chainIdDec] ?? caps?.[String(chainIdDec)];
  return byHex ?? byDec ?? null;
}

export async function supportsPaymaster(params: {
  provider: EIP1193Provider;
  from: `0x${string}`;
  chainIdHex: `0x${string}`;
}): Promise<boolean> {
  const cap = await getCapabilities(params);
  return cap?.paymasterService?.supported === true;
}

export async function getAtomicCapabilityStatus(params: {
  provider: EIP1193Provider;
  from: `0x${string}`;
  chainIdHex: `0x${string}`;
}): Promise<AtomicCapabilityStatus> {
  const cap = await getCapabilities(params);
  const status = cap?.atomic?.status;
  if (status === "supported" || status === "ready") return status;
  return null;
}

async function sendCalls(params: {
  provider: EIP1193Provider;
  chainIdHex: `0x${string}`;
  from: `0x${string}`;
  calls: Array<{ to: `0x${string}`; value: `0x${string}`; data: `0x${string}` }>;
  paymasterProxyUrl?: string;
}): Promise<unknown> {
  const callsWithSuffix = params.calls.map((c) => ({ ...c, data: appendErc8021Suffix(c.data) }));

  const baseRequest: Record<string, unknown> = {
    version: "2.0.0",
    chainId: params.chainIdHex,
    from: params.from,
    calls: callsWithSuffix,
    atomicRequired: true,
  };

  if (params.paymasterProxyUrl) {
    baseRequest.capabilities = {
      paymasterService: { url: params.paymasterProxyUrl },
    };
  }

  try {
    return (await params.provider.request({
      method: "wallet_sendCalls",
      params: [baseRequest],
    })) as any;
  } catch (e) {
    if (isUserRejected(e)) throw e;
    if (!isInvalidParams(e)) throw e;

    const fallbackRequest: Record<string, unknown> = {
      version: "1.0",
      chainId: params.chainIdHex,
      from: params.from,
      calls: callsWithSuffix,
    };

    if (params.paymasterProxyUrl) {
      fallbackRequest.capabilities = {
        paymasterService: { url: params.paymasterProxyUrl },
      };
    }

    return (await params.provider.request({
      method: "wallet_sendCalls",
      params: [fallbackRequest],
    })) as any;
  }
}

async function waitForCallsTxHash(params: {
  provider: EIP1193Provider;
  callsIdRaw: unknown;
  timeoutMs?: number;
}): Promise<`0x${string}`> {
  let callsId: unknown = params.callsIdRaw;
  if (typeof params.callsIdRaw !== "string" && params.callsIdRaw && typeof params.callsIdRaw === "object") {
    const obj = params.callsIdRaw as Record<string, unknown>;
    callsId = obj.id ?? obj.result ?? obj.callsId;
  }

  if (!callsId || typeof callsId !== "string") {
    throw new Error("wallet_sendCalls did not return a callsId");
  }

  const timeoutMs = params.timeoutMs ?? 60_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    let status: any;
    try {
      status = await params.provider.request({
        method: "wallet_getCallsStatus",
        params: [callsId],
      });
    } catch (e) {
      if (methodUnsupported(e)) {
        throw new Error("wallet_getCallsStatus not supported by this wallet");
      }
      throw e;
    }

    const code = Number(status?.status ?? 0);
    if (code === 100) {
      await sleep(1200);
      continue;
    }

    if (code === 200) {
      const receipts = status?.receipts ?? [];
      const txHash = receipts?.[0]?.transactionHash;
      if (!txHash) throw new Error("No transactionHash found in receipts");
      return txHash as `0x${string}`;
    }

    throw new Error(`Sponsored batch failed (status=${code})`);
  }

  throw new Error("Timed out waiting for transaction");
}

export async function sendSponsoredCallsAndGetTxHash(params: {
  provider: EIP1193Provider;
  chainIdHex: `0x${string}`;
  from: `0x${string}`;
  calls: Array<{ to: `0x${string}`; value: `0x${string}`; data: `0x${string}` }>;
  timeoutMs?: number;
}): Promise<`0x${string}`> {
  const paymasterProxyUrl = process.env.NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL;
  if (!paymasterProxyUrl) {
    throw new Error("Missing NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL");
  }

  const callsIdRaw = await sendCalls({
    provider: params.provider,
    chainIdHex: params.chainIdHex,
    from: params.from,
    calls: params.calls,
    paymasterProxyUrl,
  });

  return await waitForCallsTxHash({
    provider: params.provider,
    callsIdRaw,
    timeoutMs: params.timeoutMs,
  });
}

export async function sendAtomicCallsAndGetTxHash(params: {
  provider: EIP1193Provider;
  chainIdHex: `0x${string}`;
  from: `0x${string}`;
  calls: Array<{ to: `0x${string}`; value: `0x${string}`; data: `0x${string}` }>;
  timeoutMs?: number;
}): Promise<`0x${string}`> {
  const callsIdRaw = await sendCalls({
    provider: params.provider,
    chainIdHex: params.chainIdHex,
    from: params.from,
    calls: params.calls,
  });

  return await waitForCallsTxHash({
    provider: params.provider,
    callsIdRaw,
    timeoutMs: params.timeoutMs,
  });
}
