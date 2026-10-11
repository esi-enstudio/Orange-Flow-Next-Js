"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Html5Qrcode } from "html5-qrcode";
// The image decoder ships inside html5-qrcode (ZXing). It is imported directly
// because html5-qrcode's own file scanner disables ZXing's TRY_HARDER mode,
// which makes it miss barcodes that are small inside a large photo.
import * as ZXingUmd from "html5-qrcode/third_party/zxing-js.umd.js";
import { useLanguage } from "@/i18n/useLanguage";
import {
  X,
  ScanBarcode,
  Camera,
  FileImage,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  ShieldAlert
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScanned: (codes: string[]) => void;
  title?: string;
  subtitle?: string;
  maxSigned?: number;
}

const SCAN_COOLDOWN_MS = 1500;
/** Visible container that hosts the live camera scanner. */
const CAMERA_ELEMENT_ID = "barcode-scanner-camera";
/** How long we wait for the container element to be mounted. */
const ELEMENT_WAIT_MS = 2500;
/** Full-frame decode is capped to this side (memory + speed). */
const MAX_SOURCE_SIDE = 2600;
/** Tiles keep full resolution up to this side. */
const MAX_TILE_SIDE = 1600;
/** Images smaller than this are not worth tiling. */
const TILE_MIN_SOURCE_SIDE = 1200;
const TILE_GRID = 3;
const TILE_OVERLAP_RATIO = 0.2;

type ScannerErrorCode =
  | "camera_permission_denied"
  | "camera_not_found"
  | "camera_busy"
  | "camera_requires_https"
  | "camera_unsupported"
  | "camera_start_failed"
  | "file_unreadable"
  | "file_scan_failed"
  | "limit_reached";

interface ScannerError {
  code: ScannerErrorCode;
  message: string;
}

/**
 * Camera config. `aspectRatio` is intentionally omitted: html5-qrcode applies
 * it with `MediaStreamTrack.applyConstraints()`, and on devices that reject
 * that constraint the library leaks the opened stream (camera stays locked and
 * keeps failing on every retry).
 */
const CAMERA_CONFIG = {
  fps: 10,
  qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
    const size = Math.max(160, Math.min(viewfinderWidth, viewfinderHeight, 280));
    return { width: size, height: size };
  }
};

/** html5-qrcode rejects with plain strings, so never rely on `err.name`. */
function classifyCameraError(raw: unknown): ScannerErrorCode {
  const text = (
    typeof raw === "string"
      ? raw
      : raw instanceof Error
        ? `${raw.name} ${raw.message}`
        : String(raw ?? "")
  ).toLowerCase();

  if (text.includes("notallowed") || text.includes("permission") || text.includes("denied")) {
    return "camera_permission_denied";
  }
  if (
    text.includes("notreadable") ||
    text.includes("could not start video source") ||
    text.includes("trackstarterror") ||
    text.includes("in use")
  ) {
    return "camera_busy";
  }
  if (text.includes("notfound") || text.includes("requested device not found") || text.includes("no camera")) {
    return "camera_not_found";
  }
  if (text.includes("mediadevices") || text.includes("secure context")) {
    return "camera_requires_https";
  }
  if (text.includes("not supported")) {
    return "camera_unsupported";
  }
  return "camera_start_failed";
}

/** Waits (via rAF) for a container to exist, so we never construct the scanner too early. */
function waitForElement(elementId: string, timeoutMs = ELEMENT_WAIT_MS): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      const element = document.getElementById(elementId);
      if (element) {
        resolve(element);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function canUseCamera(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (!window.isSecureContext) return false;
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

/** Preferred cameras first (rear/environment), then generic fallbacks. */
async function collectCameraCandidates(): Promise<MediaTrackConstraints[]> {
  const candidates: MediaTrackConstraints[] = [];
  let cameras: Array<{ id: string; label: string }> = [];
  try {
    cameras = await Html5Qrcode.getCameras();
  } catch {
    cameras = [];
  }

  const rear = cameras.find((camera) => /back|rear|environment/i.test(camera.label));
  if (rear) candidates.push({ deviceId: { exact: rear.id } });
  candidates.push({ facingMode: "environment" });
  if (cameras[0]) candidates.push({ deviceId: { exact: cameras[0].id } });
  const last = cameras[cameras.length - 1];
  if (cameras.length > 1 && last) candidates.push({ deviceId: { exact: last.id } });
  candidates.push({ facingMode: "user" });
  return candidates;
}

//#region image decoding (ZXing)

interface ZXingReader {
  decode(bitmap: unknown): { text?: string } | null;
}
interface ZXingApi {
  MultiFormatReader: new (verbose: boolean, hints: Map<number, unknown>) => ZXingReader;
  HTMLCanvasElementLuminanceSource: new (canvas: HTMLCanvasElement) => unknown;
  HybridBinarizer: new (source: unknown) => unknown;
  BinaryBitmap: new (binarizer: unknown) => unknown;
  DecodeHintType: { POSSIBLE_FORMATS: number; TRY_HARDER: number };
  BarcodeFormat: Record<string, number>;
}

const ZXing = ZXingUmd as unknown as ZXingApi;

function buildHints(tryHarder: boolean): Map<number, unknown> {
  const hints = new Map<number, unknown>();
  const formats = Object.values(ZXing.BarcodeFormat ?? {}).filter(
    (value): value is number => typeof value === "number"
  );
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
  // TRY_HARDER makes ZXing sample many more rows, which is what finds small
  // barcodes inside a large photo.
  hints.set(ZXing.DecodeHintType.TRY_HARDER, tryHarder);
  return hints;
}

function decodeCanvas(canvas: HTMLCanvasElement, tryHarder: boolean): string | null {
  try {
    const reader = new ZXing.MultiFormatReader(false, buildHints(tryHarder));
    const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
    const result = reader.decode(bitmap);
    const text = result?.text?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}

interface ImageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Draws a region of the image (optionally rotated) scaled to fit `maxSide`. */
function renderRegion(
  image: HTMLImageElement,
  region: ImageRegion,
  rotation: 0 | 90 | 180 | 270,
  maxSide: number
): HTMLCanvasElement | null {
  const longestSide = Math.max(region.width, region.height);
  if (longestSide <= 0) return null;
  const scale = Math.min(1, maxSide / longestSide);
  const width = Math.max(1, Math.round(region.width * scale));
  const height = Math.max(1, Math.round(region.height * scale));
  const swapSides = rotation === 90 || rotation === 270;

  const canvas = document.createElement("canvas");
  canvas.width = swapSides ? height : width;
  canvas.height = swapSides ? width : height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(
    image,
    region.x,
    region.y,
    region.width,
    region.height,
    -width / 2,
    -height / 2,
    width,
    height
  );
  return canvas;
}

/**
 * Tiles the image with overlap so every barcode ends up large relative to the
 * tile it is decoded from (ZXing only samples a limited number of rows per
 * image, so a small barcode in a full frame would never be scanned).
 */
function buildTileRegions(region: ImageRegion): ImageRegion[] {
  const divisor = TILE_GRID - (TILE_GRID - 1) * TILE_OVERLAP_RATIO;
  const tileWidth = Math.round(region.width / divisor);
  const tileHeight = Math.round(region.height / divisor);
  const stepX = (region.width - tileWidth) / (TILE_GRID - 1);
  const stepY = (region.height - tileHeight) / (TILE_GRID - 1);

  const tiles: ImageRegion[] = [];
  for (let row = 0; row < TILE_GRID; row++) {
    for (let column = 0; column < TILE_GRID; column++) {
      const x = Math.round(region.x + column * stepX);
      const y = Math.round(region.y + row * stepY);
      tiles.push({
        x,
        y,
        width: Math.min(tileWidth, region.x + region.width - x),
        height: Math.min(tileHeight, region.y + region.height - y)
      });
    }
  }
  return tiles;
}

type DecodeCandidate = { label: string; region: ImageRegion; rotation: 0 | 90 | 180 | 270; maxSide: number; tryHarder: boolean };

/** Fast to slow: full frame, overlapping tiles, rotations, and a last thorough pass. */
function buildDecodePlan(sourceWidth: number, sourceHeight: number): DecodeCandidate[] {
  const full: ImageRegion = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  const plan: DecodeCandidate[] = [
    { label: "full", region: full, rotation: 0, maxSide: MAX_SOURCE_SIDE, tryHarder: false }
  ];

  if (Math.max(sourceWidth, sourceHeight) >= TILE_MIN_SOURCE_SIDE) {
    for (const region of buildTileRegions(full)) {
      plan.push({ label: "tile", region, rotation: 0, maxSide: MAX_TILE_SIDE, tryHarder: false });
    }
  }

  for (const rotation of [90, 180, 270] as const) {
    plan.push({ label: `rotate-${rotation}`, region: full, rotation, maxSide: MAX_SOURCE_SIDE, tryHarder: false });
  }

  if (Math.max(sourceWidth, sourceHeight) >= TILE_MIN_SOURCE_SIDE) {
    for (const region of buildTileRegions(full)) {
      plan.push({ label: "tile-flipped", region, rotation: 180, maxSide: MAX_TILE_SIDE, tryHarder: false });
    }
  }

  plan.push({ label: "full-try-harder", region: full, rotation: 0, maxSide: MAX_SOURCE_SIDE, tryHarder: true });
  return plan;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("IMAGE_LOAD_FAILED"));
    };
    image.src = objectUrl;
  });
}

/** Decodes every barcode candidate of the selected image. Throws if unreadable. */
async function decodeBarcodeFromImage(file: File): Promise<string | null> {
  const image = await loadImageElement(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return null;

  for (const candidate of buildDecodePlan(sourceWidth, sourceHeight)) {
    const canvas = renderRegion(image, candidate.region, candidate.rotation, candidate.maxSide);
    if (!canvas) continue;
    const text = decodeCanvas(canvas, candidate.tryHarder);
    // Release the backing store right away; these canvases are large.
    canvas.width = 0;
    canvas.height = 0;
    if (text) return text;
  }
  return null;
}

//#endregion

export function BarcodeScannerModal({
  open,
  onClose,
  onScanned,
  title,
  subtitle,
  maxSigned = 500
}: BarcodeScannerModalProps) {
  const { t, language } = useLanguage();

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startedRef = useRef(false);
  const startInFlightRef = useRef(false);
  const cancelledRef = useRef(false);
  const lastScanRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const scannedRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scanned, setScanned] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ScannerError | null>(null);
  const [isFileScanning, setIsFileScanning] = useState(false);

  const makeError = useCallback(
    (code: ScannerErrorCode): ScannerError => {
      switch (code) {
        case "camera_permission_denied":
          return { code, message: t("scanner.camera_permission_denied") };
        case "camera_not_found":
          return { code, message: t("scanner.camera_not_found") };
        case "camera_busy":
          return { code, message: t("scanner.camera_busy") };
        case "camera_requires_https":
          return { code, message: t("scanner.camera_requires_https") };
        case "camera_unsupported":
          return { code, message: t("scanner.camera_unsupported") };
        case "file_unreadable":
          return { code, message: t("scanner.file_unreadable") };
        case "limit_reached":
          return { code, message: t("scanner.limit_reached", { count: String(maxSigned) }) };
        case "file_scan_failed":
          return { code, message: t("scanner.file_scan_failed") };
        default:
          return { code: "camera_start_failed", message: t("scanner.camera_start_failed") };
      }
    },
    [maxSigned, t]
  );

  const handleDecode = useCallback(
    (decodedText: string) => {
      const code = decodedText.trim();
      if (!code) return;

      const now = Date.now();
      const prev = lastScanRef.current;
      if (prev.text === code && now - prev.at < SCAN_COOLDOWN_MS) return;
      lastScanRef.current = { text: code, at: now };

      if (scannedRef.current.includes(code)) return;
      if (scannedRef.current.length >= maxSigned) {
        setError(makeError("limit_reached"));
        return;
      }

      const next = [...scannedRef.current, code];
      scannedRef.current = next;
      setScanned(next);
      onScanned([code]);
    },
    [makeError, maxSigned, onScanned]
  );

  // Keeps the camera callback pointing at the latest render, so the camera
  // effect can depend on `open` only (restarting on every parent re-render
  // would break the live stream).
  const handleDecodeRef = useRef(handleDecode);
  useEffect(() => {
    handleDecodeRef.current = handleDecode;
  }, [handleDecode]);

  const stopCamera = useCallback(async () => {
    cancelledRef.current = true;
    startInFlightRef.current = false;
    startedRef.current = false;
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        await scanner.stop();
      } catch {
        /* not running */
      }
      try {
        scanner.clear();
      } catch {
        /* nothing to clear */
      }
    }
    setStarted(false);
    setStarting(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (startedRef.current || startInFlightRef.current) return;
    startInFlightRef.current = true;
    cancelledRef.current = false;
    setStarting(true);
    setError(null);

    const element = await waitForElement(CAMERA_ELEMENT_ID);
    if (!element) {
      startInFlightRef.current = false;
      setStarting(false);
      setError(makeError("camera_start_failed"));
      return;
    }

    if (!canUseCamera()) {
      startInFlightRef.current = false;
      setStarting(false);
      setError(makeError("camera_requires_https"));
      return;
    }

    try {
      const candidates = await collectCameraCandidates();
      let lastFailure: unknown = null;

      for (const constraints of candidates) {
        if (cancelledRef.current) break;

        const scanner = new Html5Qrcode(CAMERA_ELEMENT_ID);
        try {
          await scanner.start(
            constraints,
            CAMERA_CONFIG,
            (decodedText) => handleDecodeRef.current(decodedText),
            () => {
              /* ignore per-frame decode errors */
            }
          );
        } catch (err: unknown) {
          lastFailure = err;
          if (process.env.NODE_ENV !== "production") {
            console.warn("[BarcodeScanner] camera start failed", constraints, err);
          }
          try {
            await scanner.stop();
          } catch {
            /* start never completed */
          }
          try {
            scanner.clear();
          } catch {
            /* nothing to clear */
          }
          continue;
        }

        // Modal was closed while the camera was starting: stop it right away so
        // the device is not left locked for the next attempt.
        if (cancelledRef.current) {
          try {
            await scanner.stop();
          } catch {
            /* not running */
          }
          try {
            scanner.clear();
          } catch {
            /* nothing to clear */
          }
          break;
        }

        scannerRef.current = scanner;
        startedRef.current = true;
        setStarted(true);
        return;
      }

      if (!cancelledRef.current) {
        startedRef.current = false;
        setStarted(false);
        setError(makeError(classifyCameraError(lastFailure)));
      }
    } finally {
      startInFlightRef.current = false;
      setStarting(false);
    }
  }, [makeError]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return undefined;
    }

    scannedRef.current = [];
    setScanned([]);
    lastScanRef.current = { text: "", at: 0 };
    setError(null);
    void startCamera();

    return () => {
      void stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      void stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileScan = async (file: File | undefined) => {
    if (!file || isFileScanning) return;
    setIsFileScanning(true);
    setError(null);
    try {
      const code = await decodeBarcodeFromImage(file);
      if (code) {
        handleDecode(code);
      } else {
        setError(makeError("file_scan_failed"));
      }
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[BarcodeScanner] unable to read the selected image", err);
      }
      setError(makeError("file_unreadable"));
    } finally {
      setIsFileScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAll = useCallback(() => {
    scannedRef.current = [];
    setScanned([]);
    lastScanRef.current = { text: "", at: 0 };
  }, []);

  const showRetry = error ? error.code !== "limit_reached" && !error.code.startsWith("file_") : false;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl w-[min(100%,26rem)] max-h-[92vh] overflow-y-auto shadow-2xl"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 p-5 pb-4 border-b border-gray-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-tr from-orange-500 to-amber-400 text-white shrink-0">
                  <ScanBarcode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900 dark:text-gray-100">
                    {title || t("scanner.title")}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {subtitle || t("scanner.subtitle")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("scanner.close")}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-all shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Camera viewfinder */}
              <div className="relative rounded-2xl overflow-hidden bg-gray-900 aspect-[4/3] flex items-center justify-center">
                <div id={CAMERA_ELEMENT_ID} className="absolute inset-0" />
                {starting && (
                  <div className="relative z-10 flex flex-col items-center gap-2 text-gray-300">
                    <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
                    <span className="text-xs font-bold">{t("scanner.starting_camera")}</span>
                  </div>
                )}
                {!starting && !started && (
                  <Camera className="relative z-10 w-10 h-10 text-gray-600" />
                )}

                {/* Scan overlay corner marks */}
                {started && !starting && (
                  <div className="pointer-events-none absolute inset-0 z-[5]">
                    <div className="absolute top-2 left-2 w-8 h-8 border-t-2 border-l-2 border-orange-400 rounded-tl-xl" />
                    <div className="absolute top-2 right-2 w-8 h-8 border-t-2 border-r-2 border-orange-400 rounded-tr-xl" />
                    <div className="absolute bottom-2 left-2 w-8 h-8 border-b-2 border-l-2 border-orange-400 rounded-bl-xl" />
                    <div className="absolute bottom-2 right-2 w-8 h-8 border-b-2 border-r-2 border-orange-400 rounded-br-xl" />
                  </div>
                )}

                {/* Live count badge */}
                {scanned.length > 0 && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="absolute bottom-2.5 right-2.5 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500 text-white text-xs font-black shadow-lg"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t("scanner.scanned_count", { count: String(scanned.length) })}
                  </motion.span>
                )}
              </div>

              {/* Error message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2 text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p>{error.message}</p>
                    {showRetry && (
                      <button
                        type="button"
                        onClick={startCamera}
                        className="text-orange-600 dark:text-orange-400 font-black hover:underline cursor-pointer"
                      >
                        {t("scanner.try_again")}
                      </button>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isFileScanning}
                  className="flex-1 px-4 py-3 min-h-[44px] bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isFileScanning ? (
                    <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                  ) : (
                    <FileImage className="w-4 h-4" />
                  )}
                  {isFileScanning ? t("scanner.scanning_file") : t("scanner.upload_scan")}
                </button>
                {scanned.length > 0 && (
                  <button
                    type="button"
                    onClick={removeAll}
                    className="px-4 py-3 min-h-[44px] bg-gray-100 hover:bg-red-50 dark:bg-slate-800 dark:hover:bg-red-500/10 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t("scanner.clear_all")}
                  </button>
                )}
              </div>

              {/* Scanned list */}
              {scanned.length > 0 ? (
                <div className="max-h-36 overflow-y-auto divide-y divide-gray-50 dark:divide-slate-800 rounded-xl border border-gray-100 dark:border-slate-800">
                  {scanned.map((code, index) => (
                    <div key={`${code}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="font-mono text-xs font-bold text-gray-800 dark:text-gray-200 truncate">
                        {code}
                      </span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-[11px] font-bold text-gray-400 dark:text-gray-600 flex items-center justify-center gap-1.5 pt-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {t("scanner.no_scans_yet")}
                </p>
              )}

              {/* Done button */}
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  "w-full px-4 py-3 min-h-[48px] rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 cursor-pointer",
                  scanned.length > 0
                    ? "bg-gradient-to-tr from-orange-600 to-amber-500 hover:from-orange-700 hover:to-amber-600 text-white shadow-lg shadow-orange-200 dark:shadow-none"
                    : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                )}
              >
                <CheckCircle2 className="w-4 h-4" />
                {scanned.length > 0
                  ? t("scanner.done", { count: String(scanned.length) })
                  : t("scanner.close")}
              </button>

              <p className={cn("text-[11px] text-center font-medium", language === "bn" ? "text-gray-500 dark:text-gray-400" : "text-gray-400 dark:text-gray-600")}>
                {t("scanner.hint")}
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFileScan(e.target.files?.[0])}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
