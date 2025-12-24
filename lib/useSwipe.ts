"use client";

import { useEffect, type RefObject } from "react";
import type { Direction } from "./engine2048";

export function useSwipe(opts: {
  onDirection: (d: Direction) => void;
  enabled: boolean;
  element: RefObject<HTMLElement>;
}) {
  useEffect(() => {
    if (!opts.enabled) return;
    const el = opts.element.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let active = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      active = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const threshold = 18;

      if (Math.max(ax, ay) < threshold) return;

      if (ax > ay) {
        opts.onDirection(dx > 0 ? "right" : "left");
      } else {
        opts.onDirection(dy > 0 ? "down" : "up");
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [opts.enabled, opts.element, opts.onDirection]);
}
