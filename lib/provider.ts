import type { EIP1193Provider } from "./types";

/**
 * Browser wallet providers are discovered through EIP-6963, with WalletConnect
 * used when the user explicitly creates a QR session.
 */

type WalletConnectProvider = EIP1193Provider & {
  disconnect?: () => Promise<void>;
  connect: () => Promise<void>;
  on?: (event: string, listener: (...args: any[]) => void) => void;
  session?: unknown;
  accounts?: string[];
  chainId?: number;
};

let cachedWalletConnectProvider: WalletConnectProvider | null = null;

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
  /** Base64 icon or URL when available */
  icon?: string;
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
      out.push({ id, name: info.name, icon: info.icon, provider: provider as EIP1193Provider });
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
  if (out.length === 0) {
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

export async function connectWalletConnectProvider(): Promise<{
  provider: EIP1193Provider;
  account: `0x${string}`;
}> {
  if (typeof window === "undefined") throw new Error("WalletConnect is only available in the browser.");

  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId) throw new Error("WalletConnect is not configured.");

  if (!cachedWalletConnectProvider) {
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    const origin = window.location.origin;
    const provider = await EthereumProvider.init({
      projectId,
      optionalChains: [8453],
      showQrModal: true,
      metadata: {
        name: "2048 TX",
        description: "Play 2048 with optional onchain activity on Base.",
        url: origin,
        icons: [`${origin}/logo.png`],
      },
    });

    cachedWalletConnectProvider = provider as unknown as WalletConnectProvider;
    provider.on("disconnect", () => {
      cachedWalletConnectProvider = null;
    });
  }

  const provider = cachedWalletConnectProvider;
  if (!provider) throw new Error("WalletConnect could not be initialized.");

  // A restored WalletConnect session is already connected. Calling connect() again can
  // resolve without a new session, and making an RPC request immediately afterwards then
  // surfaces the SDK's unhelpful "Please call connect() before request()" error.
  try {
    if (!provider.session) await provider.connect();
  } catch (error) {
    // Do not let a cancelled/failed QR attempt poison the next injected-wallet choice.
    cachedWalletConnectProvider = null;
    throw error;
  }

  const account = provider.accounts?.[0];
  if (!provider.session || !account) {
    cachedWalletConnectProvider = null;
    if (provider.session && provider.disconnect) {
      await provider.disconnect().catch(() => undefined);
    }
    throw new Error("WalletConnect connection was not approved. Please try again.");
  }

  return { provider, account: account as `0x${string}` };
}

export async function disconnectWalletConnectProvider() {
  const provider = cachedWalletConnectProvider;
  cachedWalletConnectProvider = null;
  if (provider?.disconnect) {
    try {
      await provider.disconnect();
    } catch {
      // The local app state should still disconnect even if the session is already closed.
    }
  }
}

export async function getEvmProvider(): Promise<EIP1193Provider | null> {
  if (typeof window === "undefined") return null;

  // Reuse an explicitly connected WalletConnect session in normal browsers.
  // An initialized provider is not necessarily connected (for example, if the QR
  // modal was cancelled). Only prioritize WalletConnect while it has a live session.
  if (cachedWalletConnectProvider?.session) return cachedWalletConnectProvider;

  // Otherwise use the selected injected browser wallet.
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

  const toHexChainId = (raw: unknown): string | null => {
    if (typeof raw === "string") {
      // Most providers return hex ("0x2105"), but some return decimal strings.
      if (raw.startsWith("0x")) return raw;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return "0x" + n.toString(16);
    }
    if (typeof raw === "number") return "0x" + raw.toString(16);
    return null;
  };

  let currentHex: string | null = null;
  try {
    currentHex = toHexChainId(await provider.request({ method: "eth_chainId" }));
  } catch {
    // Some providers (or some locked/partially-initialized environments) may not expose
    // eth_chainId until after a connect prompt. Try common fallbacks before failing.
    try {
      currentHex = toHexChainId(await provider.request({ method: "net_version" }));
    } catch {
      // ignore
    }

    const p: any = provider as any;
    if (!currentHex && p?.chainId != null) currentHex = toHexChainId(p.chainId);
    if (!currentHex && p?.networkVersion != null) currentHex = toHexChainId(p.networkVersion);

    // If we still can't read the chainId, try switching directly.
    if (!currentHex) {
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: wanted }],
        });
        return;
      } catch (e: any) {
        if (await maybeAddBaseMainnet(e)) return;
        const msg = String(e?.message ?? e);
        if (e?.code === -32601 || /does not support|not support|Method not found/i.test(msg)) {
          throw new Error(
            `Please switch your wallet network to Base (chainId ${chainIdDec}). This wallet doesn't support programmatic switching.`
          );
        }
        throw new Error("Unable to determine or switch chain. Please open your wallet and switch to Base.");
      }
    }
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
