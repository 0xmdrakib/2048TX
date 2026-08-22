"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Palette, Save, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Wallet, Power, Grid } from "lucide-react";

import Board from "./Board";
import ThemePicker from "./ThemePicker";
import Sheet from "./ui/Sheet";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { Toast, type ToastState } from "./ui/Toast";

import { hasMoves, move, newGame, spawnRandomTile, type Direction } from "@/lib/engine2048";
import type { ThemeId } from "@/lib/themes";
import { formatMicroUsdc, shorten } from "@/lib/format";
import { randomMicroUsdc } from "@/lib/randomAmount";
import {
  getEvmProvider,
  ensureChain,
  getAccount,
  requestAccount,
  listInjectedWallets,
  getPreferredInjectedWalletId,
  setPreferredInjectedWalletId,
  connectWalletConnectProvider,
  disconnectWalletConnectProvider,
} from "@/lib/provider";
import { sendUsdcTransfer } from "@/lib/usdcTransfer";
import { getBestScore, getSubmissions, submitScore, waitForReceipt } from "@/lib/onchain";
import { useSwipe } from "@/lib/useSwipe";

type Mode = "classic" | "pay";

type PendingMove = {
  dir: Direction;
  afterMoveBoard: ReturnType<typeof move>["board"];
  scoreGain: number;
  micro: number;
  amount: string;
};

// --- PREMIUM SOUND EFFECTS SYNTHESIZER ---
let audioCtx: AudioContext | null = null;
function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}

function playSound(type: "move" | "merge" | "success" | "gameover") {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === "move") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.08);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === "merge") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === "success") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.1);
      osc.frequency.setValueAtTime(659.25, now + 0.2);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === "gameover") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.5);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    }
  } catch (e) {
    // Silently fail if audio context is blocked
  }
}

function isUserRejected(e: any) {
  const msg = String(e?.message ?? "").toLowerCase();
  return e?.code === 4001 || msg.includes("user rejected") || msg.includes("rejected") || msg.includes("cancel");
}

function WalletConnectMark() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#3B99FC]">
      <svg viewBox="0 0 300 185" aria-hidden="true" className="h-3.5 w-5 fill-white">
        <path d="M61.44 36.26c48.91-47.89 128.21-47.89 177.12 0l5.89 5.76a6.12 6.12 0 0 1 0 8.67l-20.14 19.72a3.17 3.17 0 0 1-4.43 0l-8.1-7.93c-34.12-33.41-89.44-33.41-123.56 0l-8.68 8.49a3.17 3.17 0 0 1-4.43 0L54.98 51.25a6.12 6.12 0 0 1 0-8.67l6.46-6.32ZM280.21 77.03l17.92 17.55a6.12 6.12 0 0 1 0 8.67l-80.81 79.12a6.36 6.36 0 0 1-8.86 0l-57.35-56.16a1.59 1.59 0 0 0-2.22 0l-57.35 56.16a6.36 6.36 0 0 1-8.86 0L1.87 103.25a6.12 6.12 0 0 1 0-8.67l17.92-17.55a6.36 6.36 0 0 1 8.86 0l57.35 56.15a1.59 1.59 0 0 0 2.22 0l57.35-56.15a6.36 6.36 0 0 1 8.86 0l57.35 56.15a1.59 1.59 0 0 0 2.22 0l57.35-56.15a6.36 6.36 0 0 1 8.86 0Z" />
      </svg>
    </span>
  );
}

export default function AppShell() {
  const [theme, setTheme] = useState<ThemeId>("classic");
  const [mode, setMode] = useState<Mode>("classic");
  const [gridSize, setGridSize] = useState(4);
  const [{ board, score }, setGame] = useState(() => newGame(4));
  const [gameOver, setGameOver] = useState(false);
  const [gameOverOpen, setGameOverOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [movesPaid, setMovesPaid] = useState(0);
  const [spentMicro, setSpentMicro] = useState(0);
  const [providerReady, setProviderReady] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [onchainBest, setOnchainBest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [walletChoices, setWalletChoices] = useState<Array<{ id: string; name: string; icon?: string }> | null>(null);
  const [walletChoicesLoading, setWalletChoicesLoading] = useState(false);
  const [walletConnectLoading, setWalletConnectLoading] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);
  const payLockRef = useRef(false);

  const contract = process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "8453");
  const payRecipient = process.env.NEXT_PUBLIC_PAY_RECIPIENT;

  // NOTE: touchmove prevention is handled inside useSwipe({ passive: false })
  // Do NOT add a second touchmove listener here — duplicate non-passive listeners
  // on the same element cause Safari/WKWebView to fire redundant layout events
  // which contribute to screen flickering in in-app browsers.

  // Load saved theme once on mount
  useEffect(() => {
    const saved = typeof window !== "undefined" ? (window.localStorage.getItem("theme") as ThemeId | null) : null;
    if (saved) setTheme(saved);
  }, []);

  // Apply theme (skip if unchanged to avoid redundant repaint)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = document.documentElement.getAttribute("data-theme");
    if (current !== theme) {
      document.documentElement.setAttribute("data-theme", theme);
    }
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  const reset = useCallback(() => {
    setGame(newGame(gridSize));
    setGameOver(false);
    setGameOverOpen(false);
    setPending(null);
    setMovesPaid(0);
    setSpentMicro(0);
    setToast({ message: "New game" });
    setTimeout(() => setToast(null), 1200);
  }, [gridSize]);

  const cycleGridSize = useCallback(() => {
    setGridSize((prev) => {
      const nextSize = prev === 3 ? 4 : prev === 4 ? 5 : 3;
      setGame(newGame(nextSize));
      setGameOver(false);
      setGameOverOpen(false);
      setPending(null);
      setMovesPaid(0);
      setSpentMicro(0);
      setToast({ message: `${nextSize}x${nextSize} Mode` });
      setTimeout(() => setToast(null), 1200);
      return nextSize;
    });
  }, []);

  const refreshOnchainBest = useCallback(async () => {
    if (!contract) return;
    const p = await getEvmProvider();
    if (!p) return;
    setProviderReady(true);
    const provider = p as NonNullable<typeof p>;
    const acct = await getAccount(provider);
    if (!acct) return;
    setAddress(acct);
    try {
      await ensureChain(provider, chainId);
    } catch {
      // ignore
    }
    try {
      const best = await getBestScore({ provider, contract, address: acct });
      setOnchainBest(best);
    } catch {
      // ignore
    }
  }, [contract, chainId]);

  useEffect(() => {
    refreshOnchainBest();
  }, [refreshOnchainBest]);

  const doConnect = useCallback(async () => {
    const p = await getEvmProvider();
    if (!p) {
      setToast({ message: "No wallet provider found in this client." });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setProviderReady(true);
    const provider = p as NonNullable<typeof p>;
    try {
      await ensureChain(provider, chainId);
      const acct = await requestAccount(provider);
      setAddress(acct);
      if (contract) {
        const best = await getBestScore({ provider, contract, address: acct });
        setOnchainBest(best);
      }
      setToast({ message: "Wallet connected" });
      setTimeout(() => setToast(null), 1200);
    } catch (e: any) {
      setToast({ message: e?.message ?? "Wallet connection failed" });
      setTimeout(() => setToast(null), 2500);
    }
  }, [chainId, contract]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setPreferredInjectedWalletId(null);
    setOnchainBest(null);
    void disconnectWalletConnectProvider();
  }, []);

  const connectWalletConnect = useCallback(async () => {
    if (walletConnectLoading) return;
    setWalletConnectLoading(true);
    setWalletPickerOpen(false);
    setPreferredInjectedWalletId(null);
    try {
      const { provider, account } = await connectWalletConnectProvider();
      setProviderReady(true);
      await ensureChain(provider, chainId);
      setAddress(account);
      if (contract) {
        const best = await getBestScore({ provider, contract, address: account });
        setOnchainBest(best);
      }
      setToast({ message: "WalletConnect connected" });
      setTimeout(() => setToast(null), 1200);
    } catch (e: any) {
      setToast({ message: isUserRejected(e) ? "Wallet connection cancelled" : e?.message ?? "WalletConnect failed" });
      setTimeout(() => setToast(null), 2500);
    } finally {
      setWalletConnectLoading(false);
    }
  }, [chainId, contract, walletConnectLoading]);

  const connect = useCallback(async () => {
    let inMiniApp = false;
    try {
      const { sdk } = await import("@farcaster/miniapp-sdk");
      inMiniApp = await sdk.isInMiniApp();
    } catch {
      inMiniApp = false;
    }

    if (!inMiniApp) {
      try {
        setWalletChoicesLoading(true);
        const wallets = await listInjectedWallets({ forceRefresh: true, timeoutMs: 250 });
        setWalletChoices(wallets.map((w) => ({ id: w.id, name: w.name, icon: w.icon })));
        setWalletPickerOpen(true);
        return;
      } finally {
        setWalletChoicesLoading(false);
      }
    }
    await doConnect();
  }, [doConnect]);

  const checkGameOver = useCallback(
    (b: typeof board) => {
      const ok = hasMoves(b);
      if (!ok) {
        setGameOver(true);
        setGameOverOpen(true);
        playSound("gameover");
      }
    },
    []
  );

  const applyMoveClassic = useCallback(
    (dir: Direction) => {
      if (gameOver || busy) return;
      const r = move(board, dir);
      if (!r.moved) return;
      if (r.scoreGain > 0) playSound("merge");
      else playSound("move");
      const afterSpawn = spawnRandomTile(r.board);
      setGame({ board: afterSpawn, score: score + r.scoreGain });
      checkGameOver(afterSpawn);
    },
    [board, score, gameOver, busy, checkGameOver]
  );

  const startPayFlow = useCallback(
    async (dir: Direction) => {
      if (gameOver || busy || payLockRef.current) return;
      if (!payRecipient) {
        setToast({ message: "Missing NEXT_PUBLIC_PAY_RECIPIENT" });
        setTimeout(() => setToast(null), 2400);
        return;
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(payRecipient)) {
        setToast({ message: "Invalid NEXT_PUBLIC_PAY_RECIPIENT address" });
        setTimeout(() => setToast(null), 2400);
        return;
      }

      const r = move(board, dir);
      if (!r.moved) return;

      const { micro, amount } = randomMicroUsdc();
      setPending({ dir, afterMoveBoard: r.board, scoreGain: r.scoreGain, micro, amount });

      try {
        payLockRef.current = true;
        setBusy(true);
        setToast({ message: `Opening payment… (${amount} USDC)` });

        const p = await getEvmProvider();
        if (!p) {
          setToast({ message: "No wallet provider found in this client." });
          setTimeout(() => setToast(null), 2200);
          return;
        }
        setProviderReady(true);
        const provider = p as NonNullable<typeof p>;

        await ensureChain(provider, chainId);
        const acct = (address ?? (await getAccount(provider)) ?? (await requestAccount(provider))) as `0x${string}`;
        setAddress(acct);

        const txHash = await sendUsdcTransfer({
          provider,
          from: acct,
          to: payRecipient as `0x${string}`,
          amountUnits: BigInt(micro),
        });

        setToast({ message: "Tx sent. Waiting confirmation…" });
        await waitForReceipt({ provider, txHash, timeoutMs: 60_000 });

        const afterSpawn = spawnRandomTile(r.board);
        setGame((g) => ({ board: afterSpawn, score: g.score + r.scoreGain }));
        setMovesPaid((m) => m + 1);
        setSpentMicro((s) => s + micro);
        if (r.scoreGain > 0) playSound("merge");
        else playSound("move");

        setToast({ message: "Move confirmed ✅" });
        setTimeout(() => setToast(null), 1200);
        checkGameOver(afterSpawn);
        return;
      } catch (e: any) {
        setToast({ message: isUserRejected(e) ? "User rejected tx" : e?.message ?? "Payment cancelled/failed" });
        setTimeout(() => setToast(null), 2500);
      } finally {
        setBusy(false);
        setPending(null);
        payLockRef.current = false;
      }
    },
    [board, gameOver, busy, payRecipient, checkGameOver, address, chainId]
  );

  const onDirection = useCallback(
    (dir: Direction) => {
      if (mode === "classic") applyMoveClassic(dir);
      else void startPayFlow(dir);
    },
    [mode, applyMoveClassic, startPayFlow]
  );

  useSwipe({ onDirection, enabled: !busy, element: boardRef });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const d = map[e.key];
      if (d) {
        e.preventDefault();
        onDirection(d);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDirection]);

  const saveScoreAnytime = useCallback(async (): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      if (!contract) {
        setToast({ message: "Missing NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS" });
        setTimeout(() => setToast(null), 2600);
        return false;
      }
      const p = await getEvmProvider();
      if (!p) {
        setToast({ message: "Connect a wallet to save your score." });
        setTimeout(() => setToast(null), 2200);
        await connect();
        return false;
      }
      setProviderReady(true);
      const provider = p as NonNullable<typeof p>;

      // An injected provider can exist before the user has connected an account.
      // Check that first so its currently selected chain does not produce a misleading
      // "Wrong network" message for a disconnected user.
      const acct = (address ?? (await getAccount(provider))) as `0x${string}` | null;
      if (!acct) {
        setToast({ message: "Connect a wallet to save your score." });
        setTimeout(() => setToast(null), 2200);
        await connect();
        return false;
      }
      setAddress(acct);

      const chainIdHex = (await provider.request({
        method: "eth_chainId",
        params: [],
      })) as `0x${string}`;
      const currentChainId = parseInt(chainIdHex, 16);
      if (Number.isFinite(currentChainId) && currentChainId !== chainId) {
        throw new Error("Wrong network. Please switch to Base Mainnet, then try again.");
      }

      let prevSubmissions: number | null = null;
      try {
        prevSubmissions = await getSubmissions({ provider, contract, address: acct });
      } catch {
        // non-fatal
      }

      const txHash = await submitScore({ provider, contract, from: acct, score });
      setToast({ message: "Saving score onchain…" });

      const receiptPromise = (async () => {
        const receipt = await waitForReceipt({ provider, txHash, timeoutMs: 120_000 });
        const status = (receipt as any)?.status;
        if (status === "0x0" || status === 0 || status === false) {
          throw new Error("Transaction reverted. Your score was not saved.");
        }
        return receipt;
      })();

      const racers: Promise<any>[] = [receiptPromise];

      if (prevSubmissions != null) {
        const submissionsConfirmPromise = (async () => {
          const started = Date.now();
          while (Date.now() - started < 120_000) {
            try {
              const subsNow = await getSubmissions({ provider, contract, address: acct });
              if (subsNow > prevSubmissions) return subsNow;
            } catch {
              // ignore and retry
            }
            await new Promise((r) => setTimeout(r, 1500));
          }
          throw new Error("Timed out confirming score save.");
        })();
        racers.push(submissionsConfirmPromise);
      }

      await Promise.race(racers);

      playSound("success");
      setToast({ message: "Score saved ✅" });
      setTimeout(() => setToast(null), 1400);

      void (async () => {
        try {
          const best = await getBestScore({ provider, contract, address: acct });
          setOnchainBest(best);
        } catch {
          // Non-fatal
        }
      })();

      return true;
    } catch (e: any) {
      setToast({ message: e?.message ?? "Save failed" });
      setTimeout(() => setToast(null), 3000);
      return false;
    } finally {
      setBusy(false);
    }
  }, [contract, chainId, score, address, busy, connect]);

  const saveScoreFromGameOver = useCallback(async () => {
    if (busy) return;
    const ok = await saveScoreAnytime();
    if (ok) {
      setGame(newGame(gridSize));
      setGameOver(false);
      setGameOverOpen(false);
      setPending(null);
      setMovesPaid(0);
      setSpentMicro(0);
    } else {
      setGameOverOpen(true);
    }
  }, [saveScoreAnytime, gridSize, busy]);

  const modeLabel = mode === "classic" ? "Classic" : "Pay-per-move";

  const shareCast = async (castText: string) => {
    const url = (() => {
      try {
        const u = new URL(window.location.href);
        u.search = "";
        u.hash = "";
        return u.toString();
      } catch {
        return window.location.href;
      }
    })();

    try {
      const { sdk } = await import("@farcaster/miniapp-sdk");
      await sdk.actions.composeCast({ text: castText, embeds: [url] });
      return;
    } catch {
      // fall back
    }

    try {
      if (navigator.share) {
        await navigator.share({ text: `${castText}\n\n${url}` });
        return;
      }
    } catch {}

    try {
      await navigator.clipboard.writeText(`${castText}\n\n${url}`);
      setToast({ message: "Copied share text ✅" });
      setTimeout(() => setToast(null), 1500);
    } catch {
      setToast({ message: "Sharing not supported here" });
      setTimeout(() => setToast(null), 1600);
    }
  };

  return (
    <div className="app-root">
      <Toast toast={toast} />

      <div className="app-scroll px-4 py-5">
        <div className="mx-auto w-full max-w-md">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 shrink items-center gap-2">
              <Image
                src="/logo.png"
                alt="2048 TX logo"
                width={40}
                height={40}
                priority
                className="h-9 w-9 shrink-0 rounded-xl object-cover sm:h-10 sm:w-10"
              />
              <div className="whitespace-nowrap text-2xl font-extrabold tracking-tight sm:text-3xl">2048 TX</div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {address ? (
                <div className="inline-flex h-9 items-center gap-1.5 rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] px-2 text-xs font-medium shadow-sm">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span>{shorten(address)}</span>
                  <button
                    type="button"
                    onClick={disconnect}
                    className="-mr-1 ml-0.5 rounded-full p-1 opacity-70 transition-colors hover:bg-[var(--muted)] hover:opacity-100"
                    aria-label="Disconnect"
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={connect} className="px-2.5">
                  Connect
                </Button>
              )}
            </div>
          </div>

          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            <Chip>
              <span className="text-[11px] opacity-70">Mode</span>
              <span className="font-semibold">{modeLabel}</span>
            </Chip>
            {mode === "pay" ? (
              <Chip className="w-fit pl-4 pr-5 py-1.5">
                <span className="text-[11px] opacity-70 shrink-0 relative top-[1px]">Cost</span>
                <span className="font-semibold text-[12px] whitespace-nowrap relative top-[1px]">
                  {movesPaid} moves • {formatMicroUsdc(spentMicro)}${"\u00A0"}
                </span>
              </Chip>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-[0.8fr_0.8fr_1.4fr] gap-3">
            <div className="rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-3">
              <div className="text-[11px] font-semibold opacity-70">SCORE</div>
              <div className="text-xl font-extrabold tabular-nums tracking-tight">{score}</div>
            </div>
            <div className="rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-3">
              <div className="text-[11px] font-semibold opacity-70">BEST (ONCHAIN)</div>
              <div className="text-xl font-extrabold tabular-nums tracking-tight">{onchainBest ?? "—"}</div>
            </div>
            <div className="rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-3">
              <div className="text-[11px] font-semibold opacity-70">MODE</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button size="sm" variant={mode === "classic" ? "solid" : "outline"} onClick={() => setMode("classic")} className="w-full min-w-0">
                  Classic
                </Button>
                <Button size="sm" variant={mode === "pay" ? "solid" : "outline"} onClick={() => setMode("pay")} className="w-full min-w-0">
                  Pay
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setThemeOpen(true)} aria-label="Theme" className="px-2.5">
                <Palette className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={cycleGridSize} aria-label="Grid Size" className="px-2">
                <Grid className="h-4 w-4" />
                <span className="ml-1 text-xs font-semibold">{gridSize}x{gridSize}</span>
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={reset} aria-label="New Game">
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => void saveScoreAnytime()} disabled={busy}>
                <Save className="mr-2 h-4 w-4" />
                {busy ? "Saving…" : "Save score"}
              </Button>
            </div>
          </div>

          <div className="mt-4 touch-none" ref={boardRef}>
            <Board board={board} theme={theme} isLocked={busy} />
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            <Button variant="outline" onClick={() => onDirection("up")} aria-label="Up">
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => onDirection("left")} aria-label="Left">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => onDirection("down")} aria-label="Down">
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => onDirection("right")} aria-label="Right">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {mode === "classic" ? (
            <div className="mt-6 text-center text-xs text-[var(--muted)]">
              Swipe or use arrows to play the game. In Pay mode, every move commits only after a successful payment.
            </div>
          ) : null}
        </div>
      </div>

      <Sheet
        open={walletPickerOpen}
        title="Choose wallet"
        onClose={() => {
          setWalletPickerOpen(false);
          setWalletChoices(null);
        }}
      >
        <div className="text-xs opacity-70">
          Choose a browser wallet or scan a WalletConnect QR code on Base Mainnet.
        </div>

        <div className="mt-3 space-y-2">
          {walletChoicesLoading ? (
            <div className="text-sm">Looking for wallets…</div>
          ) : null}

          {walletChoices?.map((w) => (
            <Button
              key={w.id}
              variant="outline"
              className="h-12 w-full justify-center"
              onClick={() => {
                setPreferredInjectedWalletId(w.id);
                setWalletPickerOpen(false);
                setWalletChoices(null);
                void doConnect();
              }}
            >
              <span className="flex min-w-0 items-center justify-center gap-3">
                {w.icon ? (
                  <img src={w.icon} alt={w.name} className="w-6 h-6 rounded-md object-contain" />
                ) : (
                  <Wallet className="w-5 h-5 opacity-60" />
                )}
                <span className="truncate">{w.name}</span>
              </span>
            </Button>
          ))}

          <div className="flex items-center gap-3 py-1" aria-hidden="true">
            <div className="h-px flex-1 bg-[var(--cardBorder)]" />
            <span className="text-[11px] font-medium opacity-50">OR</span>
            <div className="h-px flex-1 bg-[var(--cardBorder)]" />
          </div>

          <Button
            variant="outline"
            onClick={() => void connectWalletConnect()}
            disabled={walletConnectLoading}
            aria-busy={walletConnectLoading}
            className="h-12 w-full justify-center"
          >
            <span className="flex min-w-0 items-center justify-center gap-3">
              <WalletConnectMark />
              <span className="truncate">WalletConnect</span>
            </span>
          </Button>
        </div>

        <div className="mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPreferredInjectedWalletId(null);
              setWalletPickerOpen(false);
              setWalletChoices(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </Sheet>

      <ThemePicker
        open={themeOpen}
        theme={theme}
        onSelect={(t) => setTheme(t)}
        onClose={() => setThemeOpen(false)}
      />

      <Sheet
        open={gameOverOpen}
        title="Game over"
        onClose={() => setGameOverOpen(false)}
      >
        <div className="pb-8">
          <div className="text-sm text-[var(--muted)]">
            Your best score is only counted when you save it onchain.
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-4">
            <div className="text-xs font-semibold opacity-70">FINAL SCORE</div>
            <div className="text-3xl font-extrabold">{score}</div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={saveScoreFromGameOver} disabled={busy} className="w-full">
              {busy ? "Saving..." : "Save score onchain"}
            </Button>
            <Button variant="outline" onClick={() => shareCast(`I scored ${score} in 2048 TX`)} className="w-full">
              Share your score
            </Button>
            <Button variant="outline" onClick={reset} className="w-full">
              New game
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
