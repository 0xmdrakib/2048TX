"use client";
import { useEffect } from "react";

export default function ClientReady() {
  useEffect(() => {
    let rafId = 0;

    const setAppHeight = () => {
      const h =
        window.visualViewport?.height ||
        window.innerHeight ||
        document.documentElement.clientHeight;
      if (h > 0) {
        document.documentElement.style.setProperty("--app-height", `${h}px`);
      }
    };

    // Debounce via rAF so rapid resize events don't spam layout
    const scheduleSetHeight = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(setAppHeight);
    };

    setAppHeight();

    window.addEventListener("resize", scheduleSetHeight, { passive: true });
    window.addEventListener("orientationchange", scheduleSetHeight, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleSetHeight);
    // NOTE: intentionally NOT listening to visualViewport scroll — that fires
    // on every swipe inside the WebView and was a major flicker source.

    // Farcaster Mini-App ready — disable native gestures so back-swipe
    // doesn't trigger while the user is swiping the board
    (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        await sdk.actions.ready({ disableNativeGestures: true });
      } catch {
        // Not in a mini-app; fine.
      }
    })();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", scheduleSetHeight);
      window.removeEventListener("orientationchange", scheduleSetHeight);
      window.visualViewport?.removeEventListener("resize", scheduleSetHeight);
    };
  }, []);

  return null;
}
