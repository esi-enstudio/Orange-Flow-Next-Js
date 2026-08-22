"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Loader2, RefreshCw, Smartphone, CheckCircle2,
  AlertCircle, Wifi, WifiOff, Link2, RotateCcw, MessageCircle,
} from "lucide-react";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";

interface Props {
  open: boolean;
  houseId: number | null;
  onClose: () => void;
  onConnected?: () => void;
}

interface StatusData {
  connected: boolean;
  state: string;
  qr?: string;
  phone_number?: string;
  error?: string;
}

export default function WhatsAppConnectModal({ open, houseId, onClose, onConnected }: Props) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [showPairing, setShowPairing] = useState(false);

  const houseHeader = houseId ? { "X-House-ID": String(houseId) } : {};

  const checkStatus = useCallback(async () => {
    if (!houseId) return;
    try {
      const res = await apiClient.get("/whatsapp/status", { headers: houseHeader });
      setStatus(res.data);
    } catch {
      setStatus({ connected: false, state: "error", error: "Service unreachable" });
    }
  }, [houseId]);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Poll for scan success while a QR/pairing attempt is active.
  // Preserves the QR across status refreshes (status endpoint has no qr)
  // and re-generates it every ~45s before WhatsApp expires/rotates it.
  const startPolling = useCallback(() => {
    if (!houseId) return;
    stopPolling();
    let attempts = 0;
    const maxAttempts = 100;
    pollTimerRef.current = setInterval(async () => {
      attempts++;
      try {
        let refreshedQr: string | undefined | null = undefined;
        if (attempts % 15 === 0) {
          try {
            const r = await apiClient.post("/whatsapp/connect", null, { headers: houseHeader });
            refreshedQr = r.data?.data?.QRCode || r.data?.data?.qr_code || null;
          } catch {
            /* keep previous QR on refresh failure */
          }
        }
        const res = await apiClient.get("/whatsapp/status", { headers: houseHeader });
        const data = res.data;
        setStatus((prev) => ({
          ...data,
          connected: !!data.connected,
          state: data.connected ? "connected" : "connecting",
          qr: data.connected ? undefined : (refreshedQr ?? data.qr ?? prev?.qr),
        }));
        if (data.connected) {
          stopPolling();
          toast.success("WhatsApp connected successfully!");
          onConnected?.();
        }
      } catch {
        /* transient errors — keep polling */
      } finally {
        if (attempts >= maxAttempts) stopPolling();
      }
    }, 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId, onConnected, stopPolling]);

  useEffect(() => {
    if (!open || !houseId) return;
    setLoading(true);
    checkStatus().finally(() => setLoading(false));
  }, [open, houseId, checkStatus]);

  useEffect(() => {
    if (!open) {
      stopPolling();
      setStatus(null);
      setPhoneInput("");
      setShowPairing(false);
    }
  }, [open, stopPolling]);

  const handleSetup = async () => {
    setActionLoading(true);
    try {
      await apiClient.post("/whatsapp/setup", null, { headers: houseHeader });
      toast.success("WhatsApp device created");
      await checkStatus();
    } catch (e) {
      toast.error((e as Error).message || "Setup failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleConnect = async () => {
    setActionLoading(true);
    try {
      // Gateway returns the QR only in this response (key: QRCode);
      // /whatsapp/status never carries it, so capture before refreshing.
      const res = await apiClient.post("/whatsapp/connect", null, { headers: houseHeader });
      const qrCode: string | null =
        res.data?.data?.QRCode || res.data?.data?.qr_code || null;
      await checkStatus();
      setStatus((prev) => {
        const base: StatusData = prev ?? { connected: false, state: "connecting" };
        return { ...base, connected: false, state: "connecting", qr: qrCode ?? undefined };
      });
      startPolling();
    } catch (e) {
      toast.error((e as Error).message || "Connect failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handlePairingCode = async () => {
    if (!phoneInput.trim()) {
      toast.error("Enter phone number");
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post(
        "/whatsapp/connect/pairing",
        { phone_number: phoneInput.trim() },
        { headers: houseHeader },
      );
      toast.success("Pairing code sent. Check your phone.");
      startPolling();
    } catch (e) {
      toast.error((e as Error).message || "Pairing failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect WhatsApp for this house?")) return;
    setActionLoading(true);
    try {
      await apiClient.post("/whatsapp/disconnect", null, { headers: houseHeader });
      toast.success("WhatsApp disconnected");
      await checkStatus();
    } catch (e) {
      toast.error((e as Error).message || "Disconnect failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset WhatsApp for this house? You will need to scan QR again.")) return;
    setActionLoading(true);
    try {
      await apiClient.post("/whatsapp/reset", null, { headers: houseHeader });
      toast.success("WhatsApp reset. Run setup again.");
      await checkStatus();
    } catch (e) {
      toast.error((e as Error).message || "Reset failed");
    } finally {
      setActionLoading(false);
    }
  };

  const isConfigured = status?.state !== "not_configured";
  const isConnected = status?.connected === true;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-md p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 16, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            className="w-full max-w-md max-h-[92vh] bg-white dark:bg-slate-900 rounded-3xl border border-gray-200 dark:border-slate-700/80 shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
              <div className={cn(
                "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0",
                isConnected ? "bg-green-50 dark:bg-green-500/10" : "bg-gray-50 dark:bg-slate-800"
              )}>
                <MessageCircle className={cn("w-5 h-5",
                  isConnected ? "text-green-600 dark:text-green-400" : "text-gray-400"
                )} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-gray-100">WhatsApp Connection</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Per-house WhatsApp setup</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Status Card */}
              <div className={cn(
                "rounded-2xl border p-4",
                isConnected
                  ? "border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10"
                  : status?.state === "connecting"
                    ? "border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10"
                    : "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10"
              )}>
                <div className="flex items-center gap-3">
                  {isConnected ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0" />
                  ) : status?.state === "connecting" ? (
                    <Loader2 className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                  ) : (
                    <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400 shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className={cn("font-semibold text-sm",
                      isConnected ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"
                    )}>
                      {loading ? "Checking..." : isConnected
                        ? `Connected${status?.phone_number ? ` (${status.phone_number})` : ""}`
                        : status?.state === "connecting" ? "Waiting for QR scan..."
                          : status?.error || "Not connected"}
                    </p>
                    {status?.state === "not_configured" && (
                      <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                        Click &quot;Setup&quot; below to create a WhatsApp device for this house.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* QR Code Display */}
              {status?.qr && (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-5">
                  <Smartphone className="w-6 h-6 text-gray-400" />
                  <img
                    src={status.qr}
                    alt="WhatsApp QR"
                    className="w-52 h-52 rounded-xl"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    Open WhatsApp → Linked Devices → Link a Device → Scan this QR code
                  </p>
                </div>
              )}

              {/* Pairing Code Alternative */}
              {status?.state === "connecting" && !status?.qr && (
                <div className="rounded-2xl border border-gray-200 dark:border-slate-700 p-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Or use pairing code instead of QR
                  </p>
                  <input
                    type="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="Phone number (e.g. 8801712345678)"
                    className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500/40"
                  />
                  <button
                    onClick={handlePairingCode}
                    disabled={actionLoading || !phoneInput.trim()}
                    className="w-full flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    Send Pairing Code
                  </button>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2">
                {!isConfigured ? (
                  <button
                    onClick={handleSetup}
                    disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                    Setup WhatsApp for this House
                  </button>
                ) : !isConnected ? (
                  <button
                    onClick={handleConnect}
                    disabled={actionLoading || status?.state === "connecting"}
                    className="w-full flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading || status?.state === "connecting"
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Wifi className="w-4 h-4" />}
                    {status?.state === "connecting" ? "Scanning..." : "Connect (Generate QR)"}
                  </button>
                ) : (
                  <button
                    onClick={handleDisconnect}
                    disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl border border-red-200 dark:border-red-500/40 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <WifiOff className="w-4 h-4" />}
                    Disconnect
                  </button>
                )}

                {isConfigured && (
                  <div className="flex gap-2">
                    <button
                      onClick={checkStatus}
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                      Refresh
                    </button>
                    <button
                      onClick={handleReset}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Reset
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
