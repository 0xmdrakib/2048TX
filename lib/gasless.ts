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

    return caps?.[params.chainIdHex]?.paymasterService?.supported === true;
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
}): Promise<string> {
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
            paymasterService: { url: params.paymasterProxyUrl },
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
            paymasterService: { url: params.paymasterProxyUrl },
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

  const callsIdRaw = await sendCalls({
    provider: params.provider,
    chainIdHex: params.chainIdHex,
    from: params.from,
    calls: params.calls,
    paymasterProxyUrl,
  });

  // Some wallets return the id directly as a string; others return an object.
  const callsId =
    typeof callsIdRaw === "string"
      ? callsIdRaw
      : (callsIdRaw?.id ?? callsIdRaw?.result ?? callsIdRaw?.callsId);

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
      if (!txHash) throw new Error("No transactionHash found in receipts");
      return txHash as `0x${string}`;
    }

    throw new Error(`Sponsored batch failed (status=${code})`);
  }

  throw new Error("Timed out waiting for sponsored transaction");
}
