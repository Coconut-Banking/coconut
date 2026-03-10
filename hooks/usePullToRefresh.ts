"use client";

import { useEffect, useRef, useCallback } from "react";

const PULL_THRESHOLD = 60;

export function usePullToRefresh(onRefresh: () => void | Promise<void>, enabled: boolean) {
  const startY = useRef(0);
  const pullY = useRef(0);

  const runRefresh = useCallback(async () => {
    await onRefresh();
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;
    const main = document.querySelector("main");
    if (!main) return;

    let indicator: HTMLDivElement | null = null;

    function createIndicator() {
      if (indicator) return indicator;
      indicator = document.createElement("div");
      indicator.setAttribute("data-pull-indicator", "true");
      indicator.className = "fixed left-0 right-0 top-0 z-50 flex justify-center py-3 transition-transform duration-150 -translate-y-full";
      indicator.style.backgroundColor = "#F7FAF8";
      indicator.innerHTML = `
        <div class="flex items-center gap-2 text-sm text-[#3D8E62]">
          <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          <span>Syncing…</span>
        </div>
      `;
      document.body.appendChild(indicator);
      return indicator;
    }

    function showIdle(ind: HTMLDivElement, pullPx: number) {
      ind.className = "fixed left-0 right-0 z-50 flex justify-center py-3 transition-transform duration-150";
      ind.style.transform = `translateY(${Math.min(pullPx, 80)}px)`;
      ind.innerHTML = pullPx >= PULL_THRESHOLD
        ? `<div class="flex items-center gap-2 text-sm text-[#3D8E62]">Release to refresh</div>`
        : `<div class="flex items-center gap-2 text-sm text-gray-500">Pull down to refresh</div>`;
    }

    function showSyncing(ind: HTMLDivElement) {
      ind.className = "fixed left-0 right-0 z-50 flex justify-center py-3 transition-transform duration-150 translate-y-0";
      ind.innerHTML = `
        <div class="flex items-center gap-2 text-sm text-[#3D8E62]">
          <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          <span>Syncing…</span>
        </div>
      `;
    }

    function hideIndicator(ind: HTMLDivElement) {
      ind.style.transform = "-translate-y-full";
    }

    function handleTouchStart(e: TouchEvent) {
      if (main.scrollTop > 5) return;
      startY.current = e.touches[0].clientY;
      pullY.current = 0;
    }

    function handleTouchMove(e: TouchEvent) {
      if (main.scrollTop > 5) return;
      const y = e.touches[0].clientY;
      pullY.current = Math.max(0, y - startY.current);
      if (pullY.current > 10) {
        e.preventDefault();
        const ind = createIndicator();
        showIdle(ind, pullY.current);
      }
    }

    function handleTouchEnd() {
      const ind = document.querySelector("[data-pull-indicator]") as HTMLDivElement | null;
      if (pullY.current >= PULL_THRESHOLD && ind) {
        showSyncing(ind);
        runRefresh().finally(() => {
          hideIndicator(ind);
        });
      } else if (ind) {
        hideIndicator(ind);
      }
      pullY.current = 0;
    }

    main.addEventListener("touchstart", handleTouchStart, { passive: true });
    main.addEventListener("touchmove", handleTouchMove, { passive: false });
    main.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      main.removeEventListener("touchstart", handleTouchStart);
      main.removeEventListener("touchmove", handleTouchMove);
      main.removeEventListener("touchend", handleTouchEnd);
      const existing = document.querySelector("[data-pull-indicator]");
      if (existing) existing.remove();
    };
  }, [enabled, runRefresh]);
}
