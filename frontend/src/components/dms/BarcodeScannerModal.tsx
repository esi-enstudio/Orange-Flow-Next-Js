"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Html5Qrcode } from "html5-qrcode";
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
const READER_ID = "barcode-scanner-reader";

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
  const lastScanRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const scannedRef = useRef<string[]>([]);

  const [scanned, setScanned] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFileScanning, setIsFileScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        setError(t("scanner.limit_reached", { count: String(maxSigned) }));
        return;
      }

      const next = [...scannedRef.current, code];
      scannedRef.current = next;
      setScanned(next);
      onScanned([code]);
    },
    [maxSigned, onScanned, t]
  );

  const startCamera = useCallback(async () => {
    if (startedRef.current || startInFlightRef.current) return;
    if (!scannerRef.current) {
      scannerRef.current = new Html5Qrcode(READER_ID);
    }
    startInFlightRef.current = true;
    setStarting(true);
    setError(null);

    try {
      const scanner = scannerRef.current;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const size = Math.max(160, Math.min(viewfinderWidth, viewfinderHeight, 280));
            return { width: size, height: size };
          },
          aspectRatio: 1.0
        },
        (decodedText) => handleDecode(decodedText),
        () => {
          /* ignore per-frame decode errors */
        }
      );
      startedRef.current = true;
      setStarted(true);
    } catch (err: unknown) {
      startedRef.current = false;
      setStarted(false);
      const errName = err instanceof Error ? err.name : "";
      const message =
        errName === "NotAllowedError"
          ? t("scanner.camera_permission_denied")
          : errName === "NotFoundError"
            ? t("scanner.camera_not_found")
            : t("scanner.camera_start_failed");
      setError(message);
    } finally {
      startInFlightRef.current = false;
      setStarting(false);
    }
  }, [handleDecode, t]);

  const stopCamera = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        scannedRef.current = [];
        setScanned([]);
        lastScanRef.current = { text: "", at: 0 };
        setError(null);
        startCamera();
      }, 350);
      return () => clearTimeout(timer);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      stopCamera();
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileScan = async (file: File | undefined) => {
    if (!file || isFileScanning) return;
    if (!scannerRef.current) {
      scannerRef.current = new Html5Qrcode(READER_ID);
    }
    setIsFileScanning(true);
    setError(null);
    try {
      const decodedText = await scannerRef.current.scanFile(file, true);
      handleDecode(decodedText);
    } catch {
      setError(t("scanner.file_scan_failed"));
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
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-all shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Camera viewfinder */}
              <div className="relative rounded-2xl overflow-hidden bg-gray-900 aspect-[4/3] flex items-center justify-center">
                <div id={READER_ID} className="absolute inset-0" />
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
                    <p>{error}</p>
                    {error !== t("scanner.limit_reached", { count: String(maxSigned) }) && (
                      <button
                        type="button"
                        onClick={startCamera}
                        className="text-orange-600 dark:text-orange-400 font-black hover:underline"
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
                  className="flex-1 px-4 py-3 min-h-[44px] bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
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
                  "w-full px-4 py-3 min-h-[48px] rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2",
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