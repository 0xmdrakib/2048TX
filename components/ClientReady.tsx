"use client";
import { useEffect } from "react";

export default function ClientReady() {
  useEffect(() => {
    // Keep a stable "app height" across mobile WebViews where 100vh/100dvh can be wrong.
    const setAppHeight = () => {
      document.documentElement.style.setProperty(
        "--app-height",
        `${window.innerHeight}px`
      );
    };

    setAppHeight();
    const raf = requestAnimationFrame(setAppHeight);

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
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", setAppHeight);
      window.removeEventListener("orientationchange", setAppHeight);
    };
  }, []);

  return null;
}
