"use client";
import { useEffect } from "react";

export default function ClientReady() {
  useEffect(() => {
    // ------------------------------------------------------------------
    // Stable app height across mobile browsers.
    //
    // Mobile browsers shift their chrome (address bar, nav bar) in and out
    // of view, changing the
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
