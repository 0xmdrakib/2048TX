import type { EIP1193Provider } from "./types";

/**
 * Provider priority for Mini Apps (Base App + Farcaster clients):
 *
 * 1) Base Account SDK provider (Smart Wallet). This is the only path that can reliably
 *    support paymasterService (gas sponsorship) because paymasters are a Base Account feature.
 * 2) Farcaster Mini App provider (some clients expose an EIP-1193 provider, but it may be EOA-only).
 * 3) window.ethereum fallback.
 */

let cachedBaseAccountProvider: EIP1193Provider | null = null;

async function getBaseAccountProvider(): Promise<EIP1193Provider | null> {
  if (typeof window === "undefined") return null;
  if (cachedBaseAccountProvider) return cachedBaseAccountProvider;

  try {
    // Lazy import to keep SSR safe.
    const { createBaseAccountSDK } = await import("@base-org/account");

    const appName =
      process.env.NEXT_PUBLIC_APP_NAME ??
      process.env.NEXT_PUBLIC_SITE_NAME ??
      "2048TX";

    const appLogoUrl =
      process.env.NEXT_PUBLIC_APP_LOGO_URL ?? `${window.location.origin}/icon.png`;

    const chainIdDec = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "8453");

    const sdk = createBaseAccountSDK({
      appName,
      appLogoUrl,
      appChainIds: [chainIdDec],
    } as any);

    const provider = sdk.getProvider();
    if (provider && typeof (provider as any).request === "function") {
      cachedBaseAccountProvider = provider as unknown as EIP1193Provider;
      return cachedBaseAccountProvider;
    }
  } catch {
    // Not in Base App / Base Account not available.
  }

  return null;
}

async function getFarcasterProvider(): Promise<EIP1193Provider | null> {
  if (typeof window === "undefined") return null;

  try {
    const { sdk } = await import("@farcaster/miniapp-sdk");
    const raw = await sdk.wallet.getEthereumProvider();

    if (raw && typeof (raw as any).request === "function") {
      return raw as unknown as EIP1193Provider;
    }
  } catch {
    // ignore
  }

  return null;
}

export async function getEvmProvider(): Promise<EIP1193Provider | null> {
  if (typeof window === "undefined") return null;

  // 1) Base Account first: required for paymasterService + best UX in Base App.
  const baseAccount = await getBaseAccountProvider();
  if (baseAccount) return baseAccount;

  // 2) Farcaster provider fallback.
  const farcaster = await getFarcasterProvider();
  if (farcaster) return farcaster;

  // 3) Injected provider fallback.
  const injected = (window as any)?.ethereum;
  if (injected && typeof injected.request === "function") {
    return injected as EIP1193Provider;
  }

  return null;
}

export async function ensureChain(provider: EIP1193Provider, chainIdDec: number) {
  const wanted = "0x" + chainIdDec.toString(16);

  let currentHex: string;
  try {
    const raw = await provider.request({ method: "eth_chainId" });

    // Most providers return a hex string ("0x2105"), but some return decimal strings.
    if (typeof raw === "string") {
      currentHex = raw.startsWith("0x") ? raw : "0x" + Number(raw).toString(16);
    } else if (typeof raw === "number") {
      currentHex = "0x" + raw.toString(16);
    } else {
      currentHex = String(raw);
    }
  } catch {
    throw new Error(
      "This wallet provider doesn't support eth_chainId. Please ensure you're on Base."
    );
  }

  if (currentHex?.toLowerCase() === wanted.toLowerCase()) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: wanted }],
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (e?.code === -32601 || /does not support|not support|Method not found/i.test(msg)) {
      throw new Error(
        `Please switch your wallet network to Base (chainId ${chainIdDec}). This wallet doesn't support programmatic switching.`
      );
    }
    throw e;
  }
}

export async function getAccount(provider: EIP1193Provider): Promise<`0x${string}` | null> {
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  if (accounts && accounts[0]) return accounts[0] as `0x${string}`;
  return null;
}

export async function requestAccount(provider: EIP1193Provider): Promise<`0x${string}`> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw new Error("No account returned.");
  return accounts[0] as `0x${string}`;
}
