import type { EIP1193Provider } from "./types";

/**
 * Prefer Farcaster Mini App provider if available.
 * Fallback to window.ethereum for normal browsers/Base app webview.
 */
export async function getEvmProvider(): Promise<EIP1193Provider | null> {
  // Lazy import so SSR never touches the SDK.
  if (typeof window === "undefined") return null;

  // 1) Farcaster Mini App provider (if inside FC/Base miniapp environment)
  try {
    const { sdk } = await import("@farcaster/miniapp-sdk");
    const raw = await sdk.wallet.getEthereumProvider();

    if (raw && typeof (raw as any).request === "function") {
      return raw as unknown as EIP1193Provider;
    }
  } catch {
    // ignore
  }

  // 2) Browser provider fallback (MetaMask/Coinbase extension, etc.)
  const eth = (window as any)?.ethereum;
  if (eth && typeof eth.request === "function") {
    return eth as EIP1193Provider;
  }

  return null;
}


export async function ensureChain(provider: EIP1193Provider, chainIdDec: number) {
  const wanted = "0x" + chainIdDec.toString(16);

  // Some in-app wallets (incl. some Farcaster clients) implement only a subset of
  // EIP-1193 methods. We treat missing methods as "no programmatic switching".
  // Users can still manually switch in-wallet.
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
      "This wallet provider doesn't support eth_chainId. Please open your wallet settings and ensure you're on Base."
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
    // Common "method not found / not supported" cases.
    if (e?.code === -32601 || /does not support|not support|Method not found/i.test(msg)) {
      throw new Error(
        `Please switch your wallet network to Base (chainId ${chainIdDec}). This wallet doesn't support programmatic network switching.`
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
