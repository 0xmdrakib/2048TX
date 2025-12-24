"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BasePayButton } from "@base-org/account-ui/react";
import { pay, getPaymentStatus } from "@base-org/account";
import { RotateCcw, Palette, Save, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Wallet } from "lucide-react";

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
import { getEvmProvider, ensureChain, getAccount, requestAccount } from "@/lib/provider";
import { getBestScore, submitScore, waitForReceipt } from "@/lib/onchain";
import { sendUsdcTransfer } from "@/lib/usdcTransfer";
import { useSwipe } from "@/lib/useSwipe";

type Mode = "classic" | "pay";

type PendingMove = {
  dir: Direction;
  afterMoveBoard: ReturnType<typeof move>["board"];
  scoreGain: number;
  micro: number;
  amount: string;
};

export default function AppShell() {
  // Theme persists; mode does NOT (default classic every open).
  const [theme, setTheme] = useState<ThemeId>("classic");
  const [mode, setMode] = useState<Mode>("classic");

  const [{ board, score }, setGame] = useState(() => newGame());
  const [gameOver, setGameOver] = useState(false);

  const [themeOpen, setThemeOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const [pending, setPending] = useState<PendingMove | null>(null);

  const [movesPaid, setMovesPaid] = useState(0);
  const [spentMicro, setSpentMicro] = useState(0);

  const [providerReady, setProviderReady] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [onchainBest, setOnchainBest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Farcaster Mini App context (also used by Base App mini apps)
  const [clientFid, setClientFid] = useState<number | null>(null);

  const [toast, setToast] = useState<ToastState>(null);

  const boardRef = useRef<HTMLDivElement>(null);

  const contract = process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "8453");
  const payRecipient = process.env.NEXT_PUBLIC_PAY_RECIPIENT;
  const payRecipientAddress = process.env.NEXT_PUBLIC_PAY_RECIPIENT_ADDRESS; // used for non-BasePay flows
  const testnet = (process.env.NEXT_PUBLIC_TESTNET ?? "false") === "true";

  // Base App client fid (per Farcaster mini app compatibility docs)
  const isBaseApp = clientFid === 309857;

  // SDK ready (Farcaster mini apps show splash until ready())
  useEffect(() => {
    (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        // Also disables some native gestures that can conflict with swipe games.
        await (sdk as any).actions.ready({ disableNativeGestures: true });

        // If we are in a Mini App client, capture clientFid for routing behavior.
        const fid = (sdk as any)?.context?.client?.clientFid;
        if (typeof fid === "number") setClientFid(fid);
      } catch {
        // Not in a Farcaster mini app; ok.
      }
    })();
  }, []);

  // Hard-disable zoom gestures inside mobile webviews.
  // (Some clients ignore viewport user-scalable=no unless we also block gesture events.)
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      if ((e as any).ctrlKey) e.preventDefault();
    };

    document.addEventListener("gesturestart", prevent, { passive: false } as any);
    document.addEventListener("gesturechange", prevent, { passive: false } as any);
    document.addEventListener("gestureend", prevent, { passive: false } as any);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", prevent as any);
      document.removeEventListener("gesturechange", prevent as any);
      document.removeEventListener("gestureend", prevent as any);
      window.removeEventListener("wheel", onWheel as any);
    };
  }, []);

  // Theme persistence only
  useEffect(() => {
    const saved = typeof window !== "undefined" ? (window.localStorage.getItem("theme") as ThemeId | null) : null;
    if (saved) setTheme(saved);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const reset = useCallback(() => {
    setGame(newGame());
    setGameOver(false);
    setSaveOpen(false);
    setPayOpen(false);
    setPending(null);
    setMovesPaid(0);
    setSpentMicro(0);
    setToast({ message: "New game" });
    setTimeout(() => setToast(null), 1200);
  }, []);

  const refreshOnchainBest = useCallback(async () => {
    if (!contract) return;
    const p = await getEvmProvider();
    if (!p) return;
    setProviderReady(true);

    const acct = await getAccount(p);
    if (!acct) return;
    setAddress(acct);

    try {
      await ensureChain(p, chainId);
    } catch {
      // if chain switch fails, reads might still work on current chain, but score contract likely won't.
    }

    try {
      const best = await getBestScore({ provider: p, contract, address: acct });
      setOnchainBest(best);
    } catch {
      // ignore
    }
  }, [contract, chainId]);

  useEffect(() => {
    refreshOnchainBest();
  }, [refreshOnchainBest]);

  const connect = useCallback(async () => {
    const p = await getEvmProvider();
    if (!p) {
      setToast({ message: "No wallet provider found in this client." });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setProviderReady(true);
    try {
      await ensureChain(p, chainId);
      const acct = await requestAccount(p);
      setAddress(acct);
      if (contract) {
        const best = await getBestScore({ provider: p, contract, address: acct });
        setOnchainBest(best);
      }
      setToast({ message: "Wallet connected" });
      setTimeout(() => setToast(null), 1200);
    } catch (e: any) {
      setToast({ message: e?.message ?? "Wallet connection failed" });
      setTimeout(() => setToast(null), 2500);
    }
  }, [chainId, contract]);

  const checkGameOver = useCallback(
    (b: typeof board) => {
      const ok = hasMoves(b);
      if (!ok) {
        setGameOver(true);
        // Auto-open save sheet (still requires explicit user signature).
        setSaveOpen(true);
      }
    },
    []
  );

  const applyMoveClassic = useCallback(
    (dir: Direction) => {
      if (gameOver || busy) return;
      const r = move(board, dir);
      if (!r.moved) return;

      const afterSpawn = spawnRandomTile(r.board);
      setGame({ board: afterSpawn, score: score + r.scoreGain });
      checkGameOver(afterSpawn);
    },
    [board, score, gameOver, busy, checkGameOver]
  );

  const saveScoreAnytime = useCallback(async () => {
    if (!contract) {
      setToast({ message: "Missing NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS" });
      setTimeout(() => setToast(null), 2600);
      return;
    }
    const p = await getEvmProvider();
    if (!p) {
      setToast({ message: "No wallet provider found." });
      setTimeout(() => setToast(null), 2600);
      return;
    }
    setProviderReady(true);

    try {
      setBusy(true);
      await ensureChain(p, chainId);

      const acct = (address ?? (await getAccount(p)) ?? (await requestAccount(p))) as `0x${string}`;
      setAddress(acct);

      const txHash = await submitScore({ provider: p, contract, from: acct, score });
      setToast({ message: "Saving score onchain…" });
      await waitForReceipt({ provider: p, txHash });

      const best = await getBestScore({ provider: p, contract, address: acct });
      setOnchainBest(best);

      setToast({ message: "Score saved ✅" });
      setTimeout(() => setToast(null), 1400);
    } catch (e: any) {
      setToast({ message: e?.message ?? "Save failed" });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusy(false);
    }
  }, [contract, chainId, score, address]);

  const confirmPayment = useCallback(
    async (pm?: PendingMove) => {
      const pnd = pm ?? pending;
      if (!pnd || !payRecipient) {
        setToast({ message: "Missing pay configuration." });
        setTimeout(() => setToast(null), 2400);
        return;
      }
      if (busy) return;

      try {
        setBusy(true);
        setToast({ message: "Opening payment…" });

        const isMiniAppClient = clientFid !== null;

        // In Base App: use Base Pay (one-tap USDC, gas handled by Base).
        // In other Farcaster clients (e.g., Warpcast): Base Pay may open an external browser,
        // so we fall back to a normal ERC-20 transfer via the Mini App's EIP-1193 provider.
        if (!isMiniAppClient || isBaseApp) {
          const payment = await pay({ amount: pnd.amount, to: payRecipient, testnet });

          setToast({ message: "Payment sent. Waiting confirmation…" });

          const startedAt = Date.now();
          while (Date.now() - startedAt < 60_000) {
            const res = await getPaymentStatus({ id: payment.id, testnet });
            if (res.status === "completed") {
              const afterSpawn = spawnRandomTile(pnd.afterMoveBoard);
              setGame((g) => ({ board: afterSpawn, score: g.score + pnd.scoreGain }));
              setMovesPaid((m) => m + 1);
              setSpentMicro((s) => s + pnd.micro);

              setPayOpen(false);
              setPending(null);
              setToast({ message: "Move confirmed ✅" });
              setTimeout(() => setToast(null), 1200);

              checkGameOver(afterSpawn);
              return;
            }
            if (res.status === "failed") {
              setToast({ message: "Payment failed" });
              setTimeout(() => setToast(null), 2400);
              return;
            }
            await new Promise((r) => setTimeout(r, 1000));
          }

          setToast({ message: "Payment still pending. Try again in a moment." });
          setTimeout(() => setToast(null), 3000);
          return;
        }

        // Farcaster client fallback: normal onchain transfer (user signs in-wallet).
        const p = await getEvmProvider();
        if (!p) throw new Error("No wallet provider found in this client.");
        setProviderReady(true);

        await ensureChain(p, chainId);
        const acct = (address ?? (await getAccount(p)) ?? (await requestAccount(p))) as `0x${string}`;
        setAddress(acct);

        const toAddress = (() => {
          const isHex = (v?: string) => /^0x[a-fA-F0-9]{40}$/.test(v ?? "");
          if (isHex(payRecipientAddress)) return payRecipientAddress as `0x${string}`;
          if (isHex(payRecipient)) return payRecipient as `0x${string}`;
          throw new Error(
            "For Farcaster payments, set NEXT_PUBLIC_PAY_RECIPIENT_ADDRESS to a 0x address (Base Pay supports basenames, raw transfers do not)."
          );
        })();

        setToast({ message: "Confirm payment in wallet…" });
        const txHash = await sendUsdcTransfer({
          provider: p,
          from: acct,
          to: toAddress,
          // USDC has 6 decimals; micro USDC = 1..5 units.
          amountUnits: BigInt(pnd.micro),
        });

        await waitForReceipt({ provider: p, txHash });

        const afterSpawn = spawnRandomTile(pnd.afterMoveBoard);
        setGame((g) => ({ board: afterSpawn, score: g.score + pnd.scoreGain }));
        setMovesPaid((m) => m + 1);
        setSpentMicro((s) => s + pnd.micro);

        setPayOpen(false);
        setPending(null);
        setToast({ message: "Move confirmed ✅" });
        setTimeout(() => setToast(null), 1200);

        checkGameOver(afterSpawn);
      } catch (e: any) {
        // No desync: do not apply move
        setToast({ message: e?.message ?? "Payment cancelled/failed" });
        setTimeout(() => setToast(null), 3000);
      } finally {
        setBusy(false);
      }
    },
    [
      pending,
      payRecipient,
      payRecipientAddress,
      testnet,
      busy,
      checkGameOver,
      clientFid,
      isBaseApp,
      chainId,
      address,
    ]
  );

  const startPayFlow = useCallback(
    (dir: Direction) => {
      if (gameOver || busy) return;
      if (!payRecipient) {
        setToast({ message: "Missing NEXT_PUBLIC_PAY_RECIPIENT" });
        setTimeout(() => setToast(null), 2400);
        return;
      }
      const r = move(board, dir);
      if (!r.moved) return;

      const { micro, amount } = randomMicroUsdc();
      const pm: PendingMove = { dir, afterMoveBoard: r.board, scoreGain: r.scoreGain, micro, amount };

      // Show the sheet (so the user can see amount) but auto-start payment.
      setPending(pm);
      setPayOpen(true);
      void confirmPayment(pm);
    },
    [board, gameOver, busy, payRecipient, confirmPayment]
  );

  const onDirection = useCallback(
    (dir: Direction) => {
      if (mode === "classic") applyMoveClassic(dir);
      else startPayFlow(dir);
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

  const cancelPending = useCallback(() => {
    setPayOpen(false);
    setPending(null);
  }, []);

  const modeLabel = mode === "classic" ? "Classic" : "Pay-per-move";

  return (
    <div className="min-h-screen w-full px-4 py-5">
      <Toast toast={toast} />

      <div className="mx-auto w-full max-w-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-3xl font-extrabold tracking-tight">2048 TX</div>
            <div className="mt-1 flex items-center gap-2">
              <Chip>
                <span className="text-[11px] opacity-70">Mode</span>
                <span className="font-semibold">{modeLabel}</span>
              </Chip>
              {mode === "pay" ? (
                <Chip>
                  <span className="opacity-70">This session</span>
                  <span className="font-semibold">{movesPaid} moves</span>
                  <span className="opacity-70">•</span>
                  <span className="font-semibold">{formatMicroUsdc(spentMicro)} USDC</span>
                </Chip>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setThemeOpen(true)} aria-label="Theme">
              <Palette className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} aria-label="New Game">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-3 backdrop-blur">
            <div className="text-[11px] font-semibold opacity-70">SCORE</div>
            <div className="text-2xl font-extrabold">{score}</div>
          </div>
          <div className="rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-3 backdrop-blur">
            <div className="text-[11px] font-semibold opacity-70">BEST (ONCHAIN)</div>
            <div className="text-2xl font-extrabold">{onchainBest ?? "—"}</div>
          </div>
          <div className="rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-3 backdrop-blur">
            <div className="text-[11px] font-semibold opacity-70">MODE</div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant={mode === "classic" ? "solid" : "outline"}
                onClick={() => setMode("classic")}
                className="w-full"
              >
                Classic
              </Button>
              <Button
                size="sm"
                variant={mode === "pay" ? "solid" : "outline"}
                onClick={() => setMode("pay")}
                className="w-full"
              >
                Pay
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-[var(--muted)]">
            {address ? (
              <span className="inline-flex items-center gap-2">
                <Wallet className="h-3.5 w-3.5" />
                {shorten(address)}
              </span>
            ) : providerReady ? (
              <span>Wallet not connected</span>
            ) : (
              <span>Wallet: optional</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!address ? (
              <Button variant="outline" size="sm" onClick={connect}>
                Connect
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
              <Save className="mr-2 h-4 w-4" />
              Save score
            </Button>
          </div>
        </div>

        <div className="mt-4" ref={boardRef}>
          <Board board={board} theme={theme} isLocked={busy || Boolean(pending)} />
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

        {gameOver ? (
          <div className="mt-4 rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-4 text-sm backdrop-blur">
            <div className="font-semibold">Game over.</div>
            <div className="mt-1 text-[var(--muted)]">
              Your best score is only counted when you save it onchain.
            </div>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => setSaveOpen(true)} className="w-full">
                Save score onchain
              </Button>
              <Button variant="outline" onClick={reset} className="w-full">
                New game
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-6 text-center text-xs text-[var(--muted)]">
          Swipe or use arrows. In Pay mode, the move commits only after a successful payment confirmation.
        </div>
      </div>

      <ThemePicker
        open={themeOpen}
        theme={theme}
        onSelect={(t) => setTheme(t)}
        onClose={() => setThemeOpen(false)}
      />

      <Sheet open={saveOpen} title="Save score onchain" onClose={() => setSaveOpen(false)}>
        <div className="text-sm text-[var(--muted)]">
          Best score is tracked onchain only. If you don&apos;t save, it won&apos;t count.
        </div>

        <div className="mt-4 rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-4 backdrop-blur">
          <div className="text-xs font-semibold opacity-70">CURRENT SCORE</div>
          <div className="text-3xl font-extrabold">{score}</div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button onClick={saveScoreAnytime} disabled={busy} className="w-full">
            {busy ? "Working…" : "Save now"}
          </Button>
          <Button variant="outline" onClick={() => setSaveOpen(false)} className="w-full">
            Not now
          </Button>
        </div>

        {!contract ? (
          <div className="mt-3 text-xs text-red-600">
            Missing NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS
          </div>
        ) : null}
      </Sheet>

      <Sheet open={payOpen} title="Confirm move" onClose={cancelPending}>
        <div className="text-sm text-[var(--muted)]">
          This move requires a micro USDC payment. Amount is randomized to avoid identical-looking spam.
        </div>

        <div className="mt-4 rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-4 backdrop-blur">
          <div className="text-xs font-semibold opacity-70">AMOUNT</div>
          <div className="text-2xl font-extrabold">{pending ? pending.amount : "—"} USDC</div>
          <div className="mt-1 text-xs text-[var(--muted)]">Recipient: {payRecipient ? payRecipient : "—"}</div>

          <div className="mt-4">
            {busy ? <div className="mb-2 text-xs text-[var(--muted)]">Opening payment…</div> : null}

            {payRecipient ? (
              <div className={busy ? "pointer-events-none opacity-70" : ""}>
                {clientFid !== null && !isBaseApp ? (
                  <Button onClick={() => confirmPayment()} className="w-full">
                    Confirm payment
                  </Button>
                ) : (
                  <div className="basePayWrap">
                    <BasePayButton
                      colorScheme={theme === "amoled" || theme === "neon" ? "dark" : "light"}
                      onClick={() => confirmPayment()}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-red-600">Missing NEXT_PUBLIC_PAY_RECIPIENT</div>
            )}
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <Button variant="outline" onClick={cancelPending}>
            Cancel (don&apos;t move)
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
