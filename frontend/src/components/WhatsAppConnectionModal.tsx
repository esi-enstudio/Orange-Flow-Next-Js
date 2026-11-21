"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Loader2, RefreshCw, Smartphone, CheckCircle2,
  AlertCircle, Wifi, WifiOff, Link2, MessageCircle,
} from "lucide-react";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";

interface Props {
  open: boolean;
  connectionId: number | null;
  onClose: () => void;
  onConnected?: () => void;
  onContinue?: () => void;
}

interface StatusData {
  connected: boolean;
  state: string;
  qr?: string;
  phone_number?: string;
  error?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  const detail = (
    error as { response?: { data?: { detail?: unknown } } }
  )?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  return error instanceof Error ? error.message : fallback;
}

export default function WhatsAppConnectionModal({ open, connectionId, onClose, onConnected, onContinue }: Props) {
  const { hasPermission } = useAuth();
  const { t } = useLanguage();
  const canConnect = hasPermission("whatsapp.connect");
  const canDisconnect = hasPermission("whatsapp.disconnect");
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [showPairing, setShowPairing] = useState(false);
  const autoStartedRef = useRef<number | null>(null);

  const base = `/whatsapp/connections/${connectionId}`;

  const checkStatus = useCallback(async (): Promise<StatusData | null> => {
    if (!connectionId) return null;
    try {
      const res = await apiClient.get(`${base}/status`);
      const data: StatusData = res.data;
      setStatus(data);
      return data;
    } catch {
      const fallback: StatusData = {
        connected: false,
        state: "error",
        error: t("connectionsPage.whatsapp.modal.service_unreachable"),
      };
      setStatus(fallback);
      return fallback;
    }
  }, [base, connectionId, t]);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Poll while a QR/pairing attempt is active; re-generate QR every ~45s.
  const startPolling = useCallback(() => {
    if (!connectionId) return;
    stopPolling();
    let attempts = 0;
    const maxAttempts = 100;
    pollTimerRef.current = setInterval(async () => {
      attempts++;
      try {
        let refreshedQr: string | undefined | null = undefined;
        if (attempts % 15 === 0) {
          try {
            const r = await apiClient.post(`${base}/connect`);
            refreshedQr = r.data?.data?.QRCode || r.data?.data?.qr_code || null;
          } catch {
            /* keep previous QR on refresh failure */
          }
        }
        const res = await apiClient.get(`${base}/status`);
        const data = res.data;
        setStatus((prev) => ({
          ...data,
          connected: !!data.connected,
          state: data.connected ? "connected" : "connecting",
          qr: data.connected ? undefined : (refreshedQr ?? data.qr ?? prev?.qr),
        }));
        if (data.connected) {
          stopPolling();
          toast.success(t("connectionsPage.whatsapp.modal.connected_success"));
          onConnected?.();
        }
      } catch {
        /* transient errors — keep polling */
      } finally {
        if (attempts >= maxAttempts) stopPolling();
      }
    }, 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, onConnected, stopPolling]);

  useEffect(() => {
    if (!open) {
      stopPolling();
      setStatus(null);
      setPhoneInput("");
      setShowPairing(false);
      autoStartedRef.current = null;
    }
  }, [open, stopPolling]);

  const beginQr = useCallback(async () => {
    if (!connectionId) return;
    setActionLoading(true);
    try {
      // Gateway returns the QR only in this response; capture before refresh
      const res = await apiClient.post(`${base}/connect`);
      const qrCode: string | null =
        res.data?.data?.QRCode || res.data?.data?.qr_code || null;
      await checkStatus();
      setStatus((prev) => {
        const baseState: StatusData = prev ?? { connected: false, state: "connecting" };
        return { ...baseState, connected: false, state: "connecting", qr: qrCode ?? undefined };
      });
      startPolling();
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, t("connectionsPage.whatsapp.modal.connect_failed"))
      );
    } finally {
      setActionLoading(false);
    }
  }, [base, checkStatus, connectionId, startPolling, t]);

  const beginQrRef = useRef(beginQr);
  useEffect(() => {
    beginQrRef.current = beginQr;
  }, [beginQr]);

  // QR-first: opening the dialog for an unlinked device starts the QR flow
  // immediately instead of asking the user to press Connect a second time.
  useEffect(() => {
    if (!open || !connectionId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const data = await checkStatus();
      if (cancelled) return;
      setLoading(false);
      if (!data?.connected && canConnect && autoStartedRef.current !== connectionId) {
        autoStartedRef.current = connectionId;
        await beginQrRef.current();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, connectionId, canConnect, checkStatus]);

  const handlePairingCode = async () => {
    if (!phoneInput.trim()) {
      toast.error(t("connectionsPage.whatsapp.modal.enter_phone"));
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post(`${base}/connect/pairing`, { phone_number: phoneInput.trim() });
      toast.success(t("connectionsPage.whatsapp.modal.pairing_sent"));
      startPolling();
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, t("connectionsPage.whatsapp.modal.pairing_failed"))
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(t("connectionsPage.whatsapp.modal.disconnect_confirm"))) return;
    setActionLoading(true);
    try {
      await apiClient.post(`${base}/disconnect`);
      toast.success(t("connectionsPage.whatsapp.modal.disconnect_success"));
      await checkStatus();
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, t("connectionsPage.whatsapp.modal.disconnect_failed"))
      );
    } finally {
      setActionLoading(false);
    }
  };

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
                <h3 className="font-bold text-gray-900 dark:text-gray-100">
                  {t("connectionsPage.whatsapp.modal.shared_title")}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  {t("connectionsPage.whatsapp.modal.shared_subtitle")}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400 min-h-[44px] min-w-[44px] flex items-center justify-center"
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
                      {loading
                        ? t("connectionsPage.whatsapp.modal.checking")
                        : isConnected
                          ? `${t("connectionsPage.whatsapp.modal.connected_label")}${
                              status?.phone_number ? ` (${status.phone_number})` : ""
                            }`
                          : status?.state === "connecting"
                            ? t("connectionsPage.whatsapp.modal.waiting_scan")
                            : status?.error || t("connectionsPage.whatsapp.modal.not_connected")}
                    </p>
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
                    {t("connectionsPage.whatsapp.modal.qr_hint")}
                  </p>
                </div>
              )}

              {/* Pairing Code Alternative */}
              {canConnect && showPairing && !isConnected && !status?.qr && (
                <div className="rounded-2xl border border-gray-200 dark:border-slate-700 p-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("connectionsPage.whatsapp.modal.pairing_alt")}
                  </p>
                  <input
                    type="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder={t("connectionsPage.whatsapp.pairing_phone_placeholder")}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500/40"
                  />
                  <button
                    onClick={handlePairingCode}
                    disabled={actionLoading || !phoneInput.trim()}
                    className="w-full flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    {t("connectionsPage.whatsapp.modal.send_pairing")}
                  </button>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2">
                {!isConnected && canConnect ? (
                  <>
                    <button
                      onClick={beginQr}
                      disabled={actionLoading || status?.state === "connecting"}
                      className="w-full flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      {actionLoading || status?.state === "connecting"
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Wifi className="w-4 h-4" />}
                      {status?.state === "connecting"
                        ? t("connectionsPage.whatsapp.modal.scanning")
                        : t("connectionsPage.whatsapp.modal.connect_generate_qr")}
                    </button>
                    {!showPairing && (
                      <button
                        onClick={() => setShowPairing(true)}
                        disabled={actionLoading}
                        className="w-full flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                      >
                        <Link2 className="w-4 h-4" />
                        {t("connectionsPage.whatsapp.modal.use_pairing")}
                      </button>
                    )}
                  </>
                ) : isConnected && canDisconnect ? (
                  <button
                    onClick={handleDisconnect}
                    disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl border border-red-200 dark:border-red-500/40 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <WifiOff className="w-4 h-4" />}
                    {t("connectionsPage.actions.disconnect")}
                  </button>
                ) : null}

                {isConnected && onContinue && (
                  <button
                    onClick={onContinue}
                    className="w-full flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                  >
                    <Link2 className="w-4 h-4" />
                    {t("connectionsPage.whatsapp.choose_houses")}
                  </button>
                )}

                <button
                  onClick={checkStatus}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                  {t("connectionsPage.refresh")}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
