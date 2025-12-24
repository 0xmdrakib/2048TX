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
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === wanted.toLowerCase()) return;

  // Try switch. If the chain is not added, user will need to add it manually.
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: wanted }],
  });
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
