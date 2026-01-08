import type { EIP1193Provider } from './types';

/**
 * Minimal EIP-5792 / ERC-7677 helpers for gasless (paymaster) calls.
 *
 * Important mental model:
 * - Gasless requires a *smart wallet* that supports `wallet_sendCalls` and the `paymasterService` capability.
 * - The paymaster configuration in CDP must allowlist the *exact contract address* and *exact function signature/selector*.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type HexHash = `0x${string}`;
function isHexHash(value: unknown): value is HexHash {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}


export type WalletCall = {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: `0x${string}`;
};

function withZeroValue(calls: WalletCall[]): WalletCall[] {
  return calls.map((c) => ({ ...c, value: c.value ?? '0x0' }));
}

function pickCapabilitiesForChain(
  capabilities: any,
  chainIdHex: string,
): any | undefined {
  if (!capabilities || typeof capabilities !== 'object') return undefined;
  const chainIdDec = Number.parseInt(chainIdHex, 16).toString();
  return capabilities[chainIdHex] ?? capabilities[chainIdDec];
}

export async function supportsPaymaster(provider: EIP1193Provider, from: `0x${string}`) {
  try {
    const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string;
    const caps = (await provider.request({
      method: 'wallet_getCapabilities',
      params: [from],
    })) as any;

    const capsForChain = pickCapabilitiesForChain(caps, chainIdHex);
    return Boolean(capsForChain?.paymasterService?.supported);
  } catch {
    return false;
  }
}

type SendCallsArgs = {
  provider: EIP1193Provider;
  from: `0x${string}`;
  calls: WalletCall[];
  paymasterServiceUrl?: string;
  // You can override if needed, but usually `eth_chainId` is fine
  chainIdHexOverride?: string;
};

async function walletSendCalls(
  provider: EIP1193Provider,
  params: any,
): Promise<string> {
  const res = (await provider.request({
    method: 'wallet_sendCalls',
    params: [params],
  })) as any;

  // Some wallets return a string directly; others wrap it.
  if (typeof res === 'string') return res;
  if (res?.id) return res.id;
  if (res?.result?.id) return res.result.id;
  throw new Error('wallet_sendCalls did not return a call batch id');
}

async function waitForTxHash(
  provider: EIP1193Provider,
  callsId: string,
): Promise<`0x${string}`> {
  const deadline = Date.now() + 90_000; // 90s
  while (Date.now() < deadline) {
    const status = (await provider.request({
      method: 'wallet_getCallsStatus',
      params: [callsId],
    })) as any;

    const receipts = status?.receipts ?? status?.result?.receipts;
    const rawTxHash =
      receipts?.[0]?.transactionHash ??
      receipts?.[0]?.transactionHash?.hash;

    if (isHexHash(rawTxHash)) return rawTxHash;

    await sleep(800);
  }
  throw new Error('Timed out waiting for wallet_getCallsStatus to return a transactionHash');
}

/**
 * Sends calls via `wallet_sendCalls`.
 * - If `paymasterServiceUrl` is provided, we attach `capabilities.paymasterService.url` (ERC-7677 flow).
 * - Tries Base Account / Coinbase Smart Wallet v2.0.0 params first, and falls back to v1.0 params if needed.
 */
export async function sendSponsoredCallsAndGetTxHash({
  provider,
  from,
  calls,
  paymasterServiceUrl,
  chainIdHexOverride,
}: SendCallsArgs): Promise<`0x${string}`> {
  const chainIdHex =
    chainIdHexOverride ??
    ((await provider.request({ method: 'eth_chainId' })) as string);

  const normalizedCalls = withZeroValue(calls);

  const maybeCapabilities = paymasterServiceUrl
    ? { paymasterService: { url: paymasterServiceUrl } }
    : undefined;

  // Base Account / Coinbase Smart Wallet format (v2.0.0)
  const v2Params = {
    version: '2.0.0',
    chainId: chainIdHex,
    from,
    calls: normalizedCalls,
    atomicRequired: true,
    ...(maybeCapabilities ? { capabilities: maybeCapabilities } : {}),
  };

  // ERC-7677 example format (v1.0)
  const v1Params = {
    version: '1.0',
    chainId: chainIdHex,
    from,
    calls: normalizedCalls,
    ...(maybeCapabilities ? { capabilities: maybeCapabilities } : {}),
  };

  let callsId: string;

  try {
    callsId = await walletSendCalls(provider, v2Params);
  } catch (err: any) {
    // Some wallets only accept v1.0-style params.
    callsId = await walletSendCalls(provider, v1Params);
  }

  return await waitForTxHash(provider, callsId);
}
