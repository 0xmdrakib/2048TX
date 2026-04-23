"use client";
import { useEffect } from "react";

/**
 * Stabilizes layout in in-app browsers (Base, Farcaster, MetaMask, Warpcast, Telegram).
 * - Sets --app-height from visualViewport so 100vh doesn't jump when URL bar hides
 * - Calls sdk.ready({ disableNativeGestures: true }) so native back-swipe doesn't
 *   fight with our board swipes (this was the #1 flicker source in 2048TX).
 */
export default function ClientReady() {
  useEffect(() => {
    const setAppHeight = () => {
      const h =
        (typeof window !== "undefined" && window.visualViewport?.height) ||
        (typeof window !== "undefined" ? window.innerHeight : 0);
      if (h > 0) {
        document.documentElement.style.setProperty("--app-height", `${h}px`);
      }
    };

    setAppHeight();
    const raf = requestAnimationFrame(setAppHeight);

    window.addEventListener("resize", setAppHeight);
    window.addEventListener("orientationchange", setAppHeight);
    window.visualViewport?.addEventListener("resize", setAppHeight);
    window.visualViewport?.addEventListener("scroll", setAppHeight);

    // Farcaster Mini-App ready — disableNativeGestures is critical for swipe games
    (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        await sdk.actions.ready({ disableNativeGestures: true });
      } catch {
        // Not in a mini-app; fine.
      }
    })();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", setAppHeight);
      window.removeEventListener("orientationchange", setAppHeight);
      window.visualViewport?.removeEventListener("resize", setAppHeight);
      window.visualViewport?.removeEventListener("scroll", setAppHeight);
    };
  }, []);

  return null;
}
