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

// ---------------------------------------------------------------------------
// Web injected wallet support (multi-wallet)
//
// - Prefer EIP-6963 (multi injected provider discovery)
// - Fallback to window.ethereum.providers / window.ethereum
// ---------------------------------------------------------------------------

type InjectedWallet = {
  /** Stable-ish identifier for a specific injected wallet provider */
  id: string;
  /** Display name when available */
  name: string;
  /** EIP-1193 provider */
  provider: EIP1193Provider;
};

type EIP6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns?: string;
};

type EIP6963ProviderDetail = {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
};

type EIP6963AnnounceProviderEvent = CustomEvent<EIP6963ProviderDetail> & {
  type: "eip6963:announceProvider";
};

const PREFERRED_INJECTED_WALLET_KEY = "preferredInjectedWalletId";

let preferredInjectedWalletId: string | null = null;
let cachedInjectedWallets: InjectedWallet[] | null = null;
let injectedWalletsCachedAt = 0;

export function getPreferredInjectedWalletId(): string | null {
  if (typeof window === "undefined") return null;
  if (preferredInjectedWalletId !== null) return preferredInjectedWalletId;
  const stored = window.localStorage.getItem(PREFERRED_INJECTED_WALLET_KEY);
  preferredInjectedWalletId = stored || null;
  return preferredInjectedWalletId;
}

export function setPreferredInjectedWalletId(id: string | null) {
  if (typeof window === "undefined") return;
  preferredInjectedWalletId = id;
  if (id) window.localStorage.setItem(PREFERRED_INJECTED_WALLET_KEY, id);
  else window.localStorage.removeItem(PREFERRED_INJECTED_WALLET_KEY);
}

function nameFromInjectedProvider(p: any): string {
  if (!p) return "Injected Wallet";
  if (p.isMetaMask) return "MetaMask";
  if (p.isCoinbaseWallet) return "Coinbase Wallet";
  if (p.isBraveWallet) return "Brave Wallet";
  if (p.isRabby) return "Rabby";
  return "Injected Wallet";
}

/**
 * Discover injected wallets available in the browser.
 *
 * - Uses EIP-6963 when supported to list multiple wallets.
 * - Falls back to window.ethereum.providers or window.ethereum.
 */
export async function listInjectedWallets(opts?: {
  forceRefresh?: boolean;
  timeoutMs?: number;
}): Promise<InjectedWallet[]> {
  if (typeof window === "undefined") return [];

  const ttlMs = 5_000;
  if (!opts?.forceRefresh && cachedInjectedWallets && Date.now() - injectedWalletsCachedAt < ttlMs) {
    return cachedInjectedWallets;
  }

  const out: InjectedWallet[] = [];
  const seen = new Set<string>();

  // 1) EIP-6963 multi-provider discovery
  try {
    const handler = (event: Event) => {
      const e = event as EIP6963AnnounceProviderEvent;
      const detail = (e as any)?.detail as EIP6963ProviderDetail | undefined;
      const provider = detail?.provider as any;
      const info = detail?.info;
      if (!provider || typeof provider.request !== "function") return;
      if (!info?.uuid || !info?.name) return;

      const stable = info.rdns ? info.rdns : info.uuid;
      const id = `eip6963:${stable}`;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, name: info.name, provider: provider as EIP1193Provider });
    };

    window.addEventListener("eip6963:announceProvider", handler as any);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Give wallets a brief window to announce.
    await new Promise((r) => setTimeout(r, Math.max(50, Math.min(800, opts?.timeoutMs ?? 200))));
    window.removeEventListener("eip6963:announceProvider", handler as any);
  } catch {
    // Ignore and fall back
  }

  // 2) Fallback to window.ethereum.providers (some environments expose an array)
  const w = window as any;
  const eth = w?.ethereum;
  if (Array.isArray(eth?.providers) && eth.providers.length > 0) {
    eth.providers.forEach((p: any, idx: number) => {
      if (!p || typeof p.request !== "function") return;
      const id = `ethereum.providers:${idx}`;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, name: nameFromInjectedProvider(p), provider: p as EIP1193Provider });
    });
  } else if (eth && typeof eth.request === "function") {
    // 3) Single injected provider
    const id = "window.ethereum";
    if (!seen.has(id)) {
      seen.add(id);
      out.push({ id, name: nameFromInjectedProvider(eth), provider: eth as EIP1193Provider });
    }
  }

  cachedInjectedWallets = out;
  injectedWalletsCachedAt = Date.now();
  return out;
}

async function getInjectedWalletProvider(): Promise<EIP1193Provider | null> {
  if (typeof window === "undefined") return null;

  const wallets = await listInjectedWallets();
  if (wallets.length === 0) return null;

  const preferred = getPreferredInjectedWalletId();
  if (preferred) {
    const found = wallets.find((w) => w.id === preferred);
    if (found) return found.provider;
  }

  // If no preference is set, use the first discovered wallet.
  // The UI will prompt the user to choose when more than one wallet exists.
  return wallets[0].provider;
}

// Base App's Farcaster client FID (used for client detection in Base docs)
// See: https://docs.base.org/mini-apps/troubleshooting/base-app-compatibility
const BASE_APP_CLIENT_FID = 309857;

/**
 * Returns true when running inside the Base App (not just any Farcaster client).
 *
 * This is important because Base Account + Paymaster are Base App features.
 * In other Farcaster clients, attempting to use Base Account SDK can break the UX.
 */
export async function isBaseAppClient(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { sdk } = await import("@farcaster/miniapp-sdk");
    const inMiniApp = await sdk.isInMiniApp();
    if (!inMiniApp) return false;
    const ctx: any = await sdk.context;
    return ctx?.client?.clientFid === BASE_APP_CLIENT_FID;
  } catch {
    return false;
  }
}

async function getBaseAccountProvider(): Promise<EIP1193Provider | null> {
  if (typeof window === "undefined") return null;
  if (cachedBaseAccountProvider) return cachedBaseAccountProvider;

  // IMPORTANT: Only try Base Account SDK inside the Base App.
  // In other Farcaster clients this can cause broken connect flows.
  if (!(await isBaseAppClient())) return null;

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
  const injected = await getInjectedWalletProvider();
  if (injected) return injected;

  return null;
}

export async function ensureChain(provider: EIP1193Provider, chainIdDec: number) {
  const wanted = "0x" + chainIdDec.toString(16);

  // If Base Mainnet isn't added in the user's wallet yet, many wallets (e.g. MetaMask)
  // throw error code 4902 on wallet_switchEthereumChain. In that case, we can add Base.
  const maybeAddBaseMainnet = async (switchError: any) => {
    // Only do this for Base Mainnet to avoid changing behavior on other chains.
    if (chainIdDec !== 8453) return false;

    const msg = String(switchError?.message ?? switchError);
    const unrecognizedChain =
      switchError?.code === 4902 || /unrecognized chain|unknown chain|not added/i.test(msg);

    if (!unrecognizedChain) return false;

    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: wanted, // 0x2105
            chainName: "Base",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://mainnet.base.org"],
            blockExplorerUrls: ["https://basescan.org"],
          },
        ],
      });

      // Some wallets don't automatically switch after adding.
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: wanted }],
      });

      return true;
    } catch {
      return false;
    }
  };

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
    // If the chain isn't added, try to add Base Mainnet then retry.
    if (await maybeAddBaseMainnet(e)) return;

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
