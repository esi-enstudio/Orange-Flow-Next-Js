"use client";

/**
 * ImageLightbox - full-screen image viewer with zoom / pan.
 *
 * Built for very tall, high-resolution report images (the WhatsApp report
 * previews render at ~4600x6000 px). Two display modes:
 *   - "fit"   : whole image visible inside the viewport (default)
 *   - "manual": zoomed to a chosen % with native scrollbars for panning
 *
 * Zooming is done by re-rendering the <img> at a computed pixel width rather
 * than with a CSS transform, so the image stays crisp at every zoom level and
 * touch panning keeps working through native scrolling.
 *
 * Keyboard: Esc close · F fit/actual · + zoom in · - zoom out · 0 reset.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  Maximize2,
  Minimize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";

const ZOOM_MIN = 10;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

type ZoomFn = (delta: number, anchor?: { x: number; y: number }) => void;

interface ImageLightboxProps {
  open: boolean;
  src: string | null;
  alt: string;
  title?: string;
  /** Shown next to the zoom readout, e.g. "4608 x 3608". */
  onClose: () => void;
  className?: string;
}

export default function ImageLightbox({
  open,
  src,
  alt,
  title,
  onClose,
  className,
}: ImageLightboxProps) {
  const { t } = useLanguage();

  const [mounted, setMounted] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fitMode, setFitMode] = useState(true);
  const [zoom, setZoom] = useState(100);

  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Reset whenever a new image is opened.
  useEffect(() => {
    if (!open) return;
    setNatural(null);
    setLoaded(false);
    setFitMode(true);
    setZoom(100);
    if (scrollRef.current) scrollRef.current.scrollTo(0, 0);
  }, [open, src]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const zoomBy = useCallback<ZoomFn>((delta, anchor) => {
    setFitMode(false);
    setZoom((prev) => {
      const next = clamp(prev + delta, ZOOM_MIN, ZOOM_MAX);
      const el = scrollRef.current;
      const scroller = el?.firstElementChild as HTMLElement | null;
      if (!el || !scroller || prev === next) return next;

      // Keep the point under the cursor (or the viewport centre) anchored while
      // the image grows/shrinks, so zooming never drifts away from the detail
      // the user is inspecting.
      const ax = anchor ? anchor.x : el.clientWidth / 2;
      const ay = anchor ? anchor.y : el.clientHeight / 2;
      const ratio = next / prev;
      el.scrollLeft = (el.scrollLeft + ax) * ratio - ax;
      el.scrollTop = (el.scrollTop + ay) * ratio - ay;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setFitMode(true);
    setZoom(100);
    if (scrollRef.current) scrollRef.current.scrollTo(0, 0);
  }, []);

  const toggleFit = useCallback(() => {
    setFitMode((prev) => {
      if (prev) {
        setZoom(100);
        return false;
      }
      return true;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFit();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(-ZOOM_STEP);
      } else if (e.key === "0") {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, toggleFit, zoomBy, reset]);

  // Size of the scrollable viewport, used to compute the fit width.
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) return;
    // clientWidth/Height include padding, so subtract the wrapper's padding to
    // get the box the image may actually occupy - otherwise fit mode overflows
    // by the padding and shows a stray scrollbar.
    const measure = () => {
      const cs = innerRef.current
        ? getComputedStyle(innerRef.current)
        : null;
      const padX = cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 0;
      const padY = cs ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : 0;
      setViewport({ w: Math.max(0, el.clientWidth - padX), h: Math.max(0, el.clientHeight - padY) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const displayWidth = useMemo(() => {
    if (!natural) return undefined;
    if (fitMode) {
      if (!viewport.w || !viewport.h) return undefined;
      // Same result as `object-contain`, but as a pixel width so fit and manual
      // modes share one layout path.
      return Math.min(viewport.w, (viewport.h * natural.w) / natural.h);
    }
    return (natural.w * zoom) / 100;
  }, [natural, fitMode, viewport, zoom]);

  // React attaches wheel listeners passively on the root container, where
  // preventDefault() is ignored, so the wheel is bound imperatively with
  // passive:false to take over zoom from the wheel / trackpad pinch gesture.
  useEffect(() => {
    if (!open || !natural) return;
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, natural, zoomBy]);

  const zoomLabel = fitMode ? t("common.image_viewer.fit") : `${zoom}%`;

  const download = () => {
    if (!src) return;
    // Titles can be localised (e.g. Bengali), so fall back to a fixed name when
    // sanitising leaves nothing usable.
    const safe = (title || "")
      .trim()
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const name = `${safe || "report"}_preview.png`;
    const a = document.createElement("a");
    a.href = src;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && src && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn(
            "fixed inset-0 z-[200] flex flex-col bg-slate-950/92 backdrop-blur-sm",
            className,
          )}
          onClick={onClose}
        >
          <div
            /* Stacked on mobile: 6 x 44px controls + the zoom readout do not fit
               beside the title at 375px, and a horizontal scrollbar is not
               allowed there. */
            className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-3 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 min-w-0 sm:flex-1">
              <span className="text-sm font-semibold text-white truncate">
                {title ? `${title} \u2014 ${t("common.image_viewer.preview")}` : alt}
              </span>
              {natural && (
                <span className="hidden sm:inline text-[11px] text-slate-400 tabular-nums shrink-0">
                  {natural.w} &times; {natural.h}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <ToolbarButton
                onClick={toggleFit}
                active={!fitMode}
                label={
                  fitMode
                    ? t("common.image_viewer.show_actual")
                    : t("common.image_viewer.fit_screen")
                }
              >
                {fitMode ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
              </ToolbarButton>
              <ToolbarButton
                onClick={() => zoomBy(-ZOOM_STEP)}
                disabled={!fitMode && zoom <= ZOOM_MIN}
                label={t("common.image_viewer.zoom_out")}
              >
                <ZoomOut className="w-4 h-4" />
              </ToolbarButton>
              <span className="min-w-[3.5rem] hidden sm:inline-block text-center text-[11px] font-medium text-slate-300 tabular-nums">
                {zoomLabel}
              </span>
              <ToolbarButton
                onClick={() => zoomBy(ZOOM_STEP)}
                disabled={!fitMode && zoom >= ZOOM_MAX}
                label={t("common.image_viewer.zoom_in")}
              >
                <ZoomIn className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={reset}
                label={t("common.image_viewer.reset")}
              >
                <RotateCcw className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton onClick={download} label={t("common.image_viewer.download")}>
                <Download className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton onClick={onClose} label={t("common.image_viewer.close")}>
                <X className="w-4 h-4" />
              </ToolbarButton>
            </div>
          </div>

          <div
            ref={scrollRef}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 overflow-auto overscroll-contain"
          >
            <div
              ref={innerRef}
              className="flex min-h-full min-w-full items-center justify-center p-2 sm:p-4"
            >
              {!loaded && (
                <div
                  className="w-full max-w-2xl space-y-3 animate-pulse"
                  aria-hidden="true"
                >
                  <div className="h-6 w-2/3 rounded-lg bg-slate-800" />
                  <div className="h-4 w-1/2 rounded-lg bg-slate-800/70" />
                  <div className="h-64 w-full rounded-xl bg-slate-800/60" />
                  <div className="h-4 w-1/3 rounded-lg bg-slate-800/70" />
                </div>
              )}
{/* blob: URL from an authenticated endpoint - next/image cannot
                  optimize it, and it must render at its native resolution so the
                  zoom levels stay crisp. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                  setLoaded(true);
                }}
                onError={() => setLoaded(true)}
                style={displayWidth ? { width: `${displayWidth}px` } : undefined}
                className={cn(
                  // shrink-0 is essential: as a flex item the image would
                  // otherwise be squeezed back to the container width, so
                  // zooming past ~100% would never overflow and no scrollbar
                  // would appear.
                  "block shrink-0 select-none rounded-lg shadow-2xl",
                  fitMode ? "h-auto max-w-full" : "max-w-none",
                  !loaded && "opacity-0",
                )}
                draggable={false}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function ToolbarButton({
  onClick,
  label,
  children,
  active,
  disabled,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "flex items-center justify-center w-11 h-11 rounded-xl transition-colors cursor-pointer",
        active
          ? "bg-sky-500/20 text-sky-300"
          : "text-slate-300 hover:bg-white/10 hover:text-white",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-slate-300",
      )}
    >
      {children}
    </button>
  );
}