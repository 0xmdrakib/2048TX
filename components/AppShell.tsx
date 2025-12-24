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

  const [toast, setToast] = useState<ToastState>(null);

  const boardRef = useRef<HTMLDivElement>(null);

  const contract = process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "8453");
  const payRecipient = process.env.NEXT_PUBLIC_PAY_RECIPIENT;
  const testnet = (process.env.NEXT_PUBLIC_TESTNET ?? "false") === "true";

  // SDK ready (Farcaster mini apps show splash until ready())
  useEffect(() => {
    (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        await sdk.actions.ready();
      } catch {
        // Not in a Farcaster mini app; ok.
      }
    })();
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

  // Same as reset(), but without showing any toast. Useful when we want to
  // transition immediately after another successful action (e.g. saving score).
  const resetSilent = useCallback(() => {
    setGame(newGame());
    setGameOver(false);
    setSaveOpen(false);
    setPayOpen(false);
    setPending(null);
    setMovesPaid(0);
    setSpentMicro(0);
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
      setPending({ dir, afterMoveBoard: r.board, scoreGain: r.scoreGain, micro, amount });
      setPayOpen(true);
    },
    [board, gameOver, busy, payRecipient]
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
      // Some embedded wallets implement only a subset of EIP-1193.
      // ensureChain will throw a friendly error if switching is not supported.
      await ensureChain(p, chainId);

      const acct = (address ?? (await getAccount(p)) ?? (await requestAccount(p))) as `0x${string}`;
      setAddress(acct);

      // Capture the current submissions count so we can confirm success even if
      // the embedded provider is flaky about receipts.
      let prevSubmissions: number | null = null;
      try {
        prevSubmissions = await getSubmissions({ provider: p, contract, address: acct });
      } catch {
        // non-fatal
      }

      const txHash = await submitScore({ provider: p, contract, from: acct, score });
      setToast({ message: "Saving score onchain…" });

      const receiptPromise = (async () => {
        const receipt = await waitForReceipt({ provider: p, txHash, timeoutMs: 120_000 });
        const status = (receipt as any)?.status;
        if (status === "0x0" || status === 0 || status === false) {
          throw new Error("Transaction reverted. Your score was not saved.");
        }
        return receipt;
      })();

      const racers: Promise<any>[] = [receiptPromise];

      // Fallback confirmation: if we can observe submissions incrementing, we know
      // the transaction was mined (this works for both "best" and non-best scores).
      if (prevSubmissions != null) {
        const submissionsConfirmPromise = (async () => {
          const started = Date.now();
          while (Date.now() - started < 120_000) {
            try {
              const subsNow = await getSubmissions({ provider: p, contract, address: acct });
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

      // Whichever confirms first: receipt OR onchain state change.
      await Promise.race(racers);

      // Close the sheet immediately after the tx is confirmed.
      // Do NOT block UX on a follow-up read, because some embedded providers
      // (especially in the Base app) can hang on eth_call even after a successful tx.
      setSaveOpen(false);

      setToast({ message: "Score saved ✅" });
      setTimeout(() => setToast(null), 1400);

      // If the game was already over, start a fresh game automatically after a
      // successful save. This keeps the flow snappy (save → play again) without
      // requiring an extra "New game" tap.
      if (gameOver) {
        resetSilent();
      }

      // Refresh best in the background (non-blocking).
      void (async () => {
        try {
          const best = await getBestScore({ provider: p, contract, address: acct });
          setOnchainBest(best);
        } catch {
          // Non-fatal: the tx is saved even if we can't refresh best right now.
        }
      })();
    } catch (e: any) {
      setToast({ message: e?.message ?? "Save failed" });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusy(false);
    }
  }, [contract, chainId, score, address, gameOver, resetSilent]);

  const confirmPendingPayment = useCallback(async () => {
    if (!pending || !payRecipient) {
      setToast({ message: "Missing pay configuration." });
      setTimeout(() => setToast(null), 2400);
      return;
    }
    if (busy) return;

    try {
      setBusy(true);
      setToast({ message: "Opening payment…" });

      const payment = await pay({ amount: pending.amount, to: payRecipient, testnet });

      setToast({ message: "Payment sent. Waiting confirmation…" });

      const startedAt = Date.now();
      // Poll for up to 60s. Base Pay usually confirms quickly, but we keep it sane.
      while (Date.now() - startedAt < 60_000) {
        const res = await getPaymentStatus({ id: payment.id, testnet });
        if (res.status === "completed") {
          const afterSpawn = spawnRandomTile(pending.afterMoveBoard);
          setGame((g) => ({ board: afterSpawn, score: g.score + pending.scoreGain }));
          setMovesPaid((m) => m + 1);
          setSpentMicro((s) => s + pending.micro);

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
        // pending / not_found: wait and try again
        await new Promise((r) => setTimeout(r, 1000));
      }

      setToast({ message: "Payment still pending. Try again in a moment." });
      setTimeout(() => setToast(null), 3000);
    } catch (e: any) {
      // No desync: do not apply move
      setToast({ message: e?.message ?? "Payment cancelled/failed" });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusy(false);
    }
  }, [pending, payRecipient, testnet, busy, checkGameOver]);

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

        {/* Make MODE a bit wider to prevent UI jitter on small screens */}
        <div className="mt-4 grid grid-cols-[0.8fr_0.8fr_1.4fr] gap-3">
          <div className="rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-3 backdrop-blur">
            <div className="text-[11px] font-semibold opacity-70">SCORE</div>
            <div className="text-xl font-extrabold">{score}</div>
          </div>
          <div className="rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-3 backdrop-blur">
            <div className="text-[11px] font-semibold opacity-70">BEST (ONCHAIN)</div>
            <div className="text-xl font-extrabold">{onchainBest ?? "—"}</div>
          </div>
          <div className="rounded-2xl border border-[var(--cardBorder)] bg-[var(--card)] p-3 backdrop-blur">
            <div className="text-[11px] font-semibold opacity-70">MODE</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant={mode === "classic" ? "solid" : "outline"}
                onClick={() => setMode("classic")}
                className="w-full min-w-0"
              >
                Classic
              </Button>
              <Button
                size="sm"
                variant={mode === "pay" ? "solid" : "outline"}
                onClick={() => setMode("pay")}
                className="w-full min-w-0"
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
          Swipe or use arrows. In Pay mode, the move commits only after a successful Base Pay payment.
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
          <div className="text-2xl font-extrabold">
            {pending ? pending.amount : "—"} USDC
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            Recipient: {payRecipient ? payRecipient : "—"}
          </div>
        </div>

        <div className="mt-4">
          {payRecipient ? (
            <div className={busy ? "pointer-events-none opacity-70" : ""}>
              <BasePayButton
                colorScheme={theme === "amoled" || theme === "neon" ? "dark" : "light"}
                onClick={confirmPendingPayment}
              />
            </div>
          ) : (
            <div className="text-xs text-red-600">Missing NEXT_PUBLIC_PAY_RECIPIENT</div>
          )}
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
