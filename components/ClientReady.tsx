"use client";
import { useEffect } from "react";

export default function ClientReady() {
  useEffect(() => {
    // ------------------------------------------------------------------
    // Stable app height across all mobile WebViews and in-app browsers.
    //
    // Problem: In-app browsers (Warpcast, Instagram, TikTok, etc.) shift
    // their chrome (address bar, nav bar) in/out of view, changing the
    // visible viewport height. `window.innerHeight` and `100vh` lag behind
    // or use the WRONG value (e.g. the full height including hidden chrome).
    //
    // Fix: Use `window.visualViewport.height` which always reflects the
    // actual visible area. Wrap in requestAnimationFrame to batch rapid
    // resize events (prevents multiple React re-renders per chrome toggle).
    // ------------------------------------------------------------------
    let rafId: number | null = null;

    const setAppHeight = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const h = window.visualViewport
          ? window.visualViewport.height
          : window.innerHeight;
        document.documentElement.style.setProperty("--app-height", `${h}px`);
        rafId = null;
      });
    };

    setAppHeight();

    // visualViewport fires on keyboard show/hide and browser chrome toggle
    window.visualViewport?.addEventListener("resize", setAppHeight);
    window.visualViewport?.addEventListener("scroll", setAppHeight);
    // Fallback for browsers without visualViewport support
    window.addEventListener("resize", setAppHeight);
    window.addEventListener("orientationchange", setAppHeight);

    // For games, disabling native gestures prevents accidental swipe-to-dismiss.
    (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        await sdk.actions.ready({ disableNativeGestures: true });
      } catch {
        // Not in a mini-app; fine.
      }
    })();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.visualViewport?.removeEventListener("resize", setAppHeight);
      window.visualViewport?.removeEventListener("scroll", setAppHeight);
      window.removeEventListener("resize", setAppHeight);
      window.removeEventListener("orientationchange", setAppHeight);
    };
  }, []);

  return null;
}
