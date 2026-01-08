import type { EIP1193Provider } from "./types";

type JsonRpcError = { code?: number; message?: string };

function methodUnsupported(e: unknown) {
  const err = e as JsonRpcError;
  const msg = String(err?.message ?? e);
  return err?.code === -32601 || /does not support|not support|Method not found/i.test(msg);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function supportsPaymaster(params: {
  provider: EIP1193Provider;
  from: `0x${string}`;
  chainIdHex: `0x${string}`;
}): Promise<boolean> {
  try {
    const caps = (await params.provider.request({
      method: "wallet_getCapabilities",
      params: [params.from],
    })) as any;

    // Different implementations key this map differently (hex chainId like "0x2105" vs decimal like 8453).
    const chainIdDec = Number.parseInt(params.chainIdHex, 16);
    const byHex = caps?.[params.chainIdHex];
    const byDec = caps?.[chainIdDec] ?? caps?.[String(chainIdDec)];
    const cap = byHex ?? byDec;

    // Per EIP-5792 / Base Account docs:
    // { "0x2105": { paymasterService: { supported: true } } }
    return cap?.paymasterService?.supported === true;
  } catch (e) {
    if (methodUnsupported(e)) return false;
    return false;
  }
}

async function sendCalls(params: {
  provider: EIP1193Provider;
  chainIdHex: `0x${string}`;
  from: `0x${string}`;
  calls: Array<{ to: `0x${string}`; value: `0x${string}`; data: `0x${string}` }>;
  paymasterProxyUrl: string;
}): Promise<unknown> {
  // Try newer shape first (some wallets want this),
  // then fall back to the simpler 1.0 style used in Base docs.
  try {
    return (await params.provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          chainId: params.chainIdHex,
          from: params.from,
          calls: params.calls,
          atomicRequired: true,
          capabilities: {
            // `optional: true` means wallets that *don't* support paymasters
            // can still process the request (it will just not be sponsored).
            paymasterService: { url: params.paymasterProxyUrl, optional: true },
          },
        },
      ],
    })) as any;
  } catch (e) {
    // Fall back to 1.0 style from Base docs
    return (await params.provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "1.0",
          chainId: params.chainIdHex,
          from: params.from,
          calls: params.calls,
          capabilities: {
            paymasterService: { url: params.paymasterProxyUrl, optional: true },
          },
        },
      ],
    })) as any;
  }
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

  const callsIdRaw: unknown = await sendCalls({
    provider: params.provider,
    chainIdHex: params.chainIdHex,
    from: params.from,
    calls: params.calls,
    paymasterProxyUrl,
  });

  // Some wallets return the id directly as a string; others return an object.
  let callsId: unknown = callsIdRaw;
  if (typeof callsIdRaw !== "string" && callsIdRaw && typeof callsIdRaw === "object") {
    const obj = callsIdRaw as Record<string, unknown>;
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

    // 100 = pending; 200 = success; 4xx/5xx/6xx = failures per Base docs
    if (code === 100) {
      await sleep(1200);
      continue;
    }

    if (code === 200) {
      const receipts = status?.receipts ?? [];
      const txHash = receipts?.[0]?.transactionHash;
      if (typeof txHash === "string" && txHash.startsWith("0x")) {
        return txHash as `0x${string}`;
      }
      throw new Error("No transactionHash found in receipts");
    }

    throw new Error(`Sponsored batch failed (status=${code})`);
  }

  throw new Error("Timed out waiting for sponsored transaction");
}
