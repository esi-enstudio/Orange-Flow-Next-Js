"use client";

import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import type { LiveMapLabels } from "./liveMapShared";

/**
 * The overlay chrome (legend, fullscreen button, empty overlay) is identical for
 * every map provider, so both the Leaflet and the Google map render these
 * instead of keeping their own copies.
 */
export function MapLegend({ labels }: { labels: LiveMapLabels }) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] rounded-xl border border-gray-200/80 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {labels.legend}
      </p>
      <div className="space-y-1">
        <LegendRow color="#10b981" label={labels.online} />
        <LegendRow color="#64748b" label={labels.offline} />
        <LegendRow color="#f59e0b" label={labels.low_battery} />
      </div>
    </div>
  );
}

export function MapEmptyOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center bg-white/70 backdrop-blur-[1px] dark:bg-slate-950/60">
      <p className="px-4 text-center text-sm font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
    </div>
  );
}

export function FullscreenButton({
  canFullscreen,
  isFullscreen,
  labels,
  onToggle,
}: {
  canFullscreen: boolean;
  isFullscreen: boolean;
  labels: LiveMapLabels;
  onToggle: () => void;
}) {
  if (!canFullscreen) return null;
  const text = isFullscreen ? labels.exit_fullscreen : labels.fullscreen;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={text}
      aria-label={text}
      className="absolute right-3 top-3 z-[1000] flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200/80 bg-white/95 px-3 py-2.5 text-xs font-semibold text-gray-600 shadow-lg backdrop-blur transition-colors hover:bg-gray-100 sm:min-h-0 dark:border-slate-700 dark:bg-slate-900/95 dark:text-gray-300 dark:hover:bg-slate-800"
    >
      {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{text}</span>
    </button>
  );
}

/** Tracks native fullscreen for the map card the ref points at. */
export function useMapFullscreen(rootRef: React.RefObject<HTMLDivElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);

  useEffect(() => {
    setCanFullscreen(
      typeof document !== "undefined" &&
        document.fullscreenEnabled === true &&
        typeof document.documentElement.requestFullscreen === "function"
    );
    const onChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [rootRef]);

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* Fullscreen can be blocked by the browser; ignore. */
    }
  }, [rootRef]);

  return { isFullscreen, canFullscreen, toggleFullscreen };
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  );
}
