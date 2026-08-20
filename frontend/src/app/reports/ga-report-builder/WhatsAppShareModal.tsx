"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Send, MessageCircle, Loader2, RefreshCw,
  AlertCircle, Smartphone, CheckCircle2, Image as ImageIcon,
  AlignLeft, FileSpreadsheet,
} from "lucide-react";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/i18n/useLanguage";
import WhatsAppConnectModal from "@/components/WhatsAppConnectModal";

export interface ReportPayloadConfig {
  event_id?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  retailer_codes: string[];
  rso_ids: number[];
  columns: string[];
  filters: {
    exclude_product_codes: string[];
    exclude_retailer_tags: string[];
  };
  sort_by: string;
  sort_order: string;
}

interface Props {
  open: boolean;
  houseId: number | null;
  payload: ReportPayloadConfig;
  onClose: () => void;
  onSent?: () => void;
}

interface WsStatus {
  connected: boolean;
  state?: string;
  qr?: string;
  error?: string;
}

interface WsGroup {
  id: string;
  name: string;
}

type SendFormat = "image" | "text" | "excel";

export default function WhatsAppShareModal({ open, houseId, payload, onClose, onSent }: Props) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<WsStatus | null>(null);
  const [groups, setGroups] = useState<WsGroup[]>([]);
  const [chatId, setChatId] = useState("");
  const [format, setFormat] = useState<SendFormat>("image");
  const [caption, setCaption] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);

  const houseHeader = houseId ? { "X-House-ID": String(houseId) } : {};

  const loadStatus = async () => {
    try {
      const res = await apiClient.get("/whatsapp/status", { headers: houseHeader });
      setStatus(res.data);
    } catch {
      setStatus({ connected: false, state: "unreachable", error: "Service unreachable" });
    }
  };

  useEffect(() => {
    if (!open) return;
    setChecking(true);
    setChatId("");
    setFormat("image");
    setCaption("");
    (async () => {
      try {
        const [statusRes, groupsRes] = await Promise.all([
          apiClient.get("/whatsapp/status", { headers: houseHeader }),
          apiClient.get("/whatsapp/groups", { headers: houseHeader }),
        ]);
        setStatus(statusRes.data);
        setGroups(groupsRes.data?.data ?? []);
      } catch {
        setStatus({ connected: false, state: "unreachable", error: "Service unreachable" });
      } finally {
        setChecking(false);
      }
    })();
    const timer = setInterval(() => {
      apiClient.get("/whatsapp/status", { headers: houseHeader }).then((r) => setStatus(r.data)).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [open]);

  const closeModal = () => {
    setStatus(null);
    setGroups([]);
    setChatId("");
    setCaption("");
    onClose();
  };

  const send = async () => {
    if (!chatId) {
      toast.error(t("ga_report_builder.whatsapp.group_placeholder"));
      return;
    }
    const group = groups.find((g) => g.id === chatId);
    setLoading(true);
    try {
      const body = {
        ...payload,
        house_id: houseId,
        whatsapp_chat_id: chatId,
        whatsapp_chat_name: group?.name ?? null,
        caption: caption || null,
        format,
      };
      await apiClient.post("/ga-report-builder/whatsapp/send", body, { headers: houseHeader });
      toast.success(t("ga_report_builder.whatsapp.success"));
      onSent?.();
      closeModal();
    } catch (e) {
      toast.error((e as Error).message || t("ga_report_builder.whatsapp.error"));
    } finally {
      setLoading(false);
    }
  };

  const formats: Array<{ key: SendFormat; icon: typeof ImageIcon; label: string }> = [
    { key: "image", icon: ImageIcon, label: t("ga_report_builder.whatsapp.image") },
    { key: "text", icon: AlignLeft, label: t("ga_report_builder.whatsapp.text") },
    { key: "excel", icon: FileSpreadsheet, label: t("ga_report_builder.whatsapp.excel") },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-md p-4"
          onClick={closeModal}
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
              <div className="w-11 h-11 rounded-2xl bg-green-50 dark:bg-green-500/10 flex items-center justify-center shrink-0">
                <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-gray-100">{t("ga_report_builder.whatsapp.title")}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">GA Report Builder</p>
              </div>
              <button
                onClick={closeModal}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400"
                title={t("common.close") || "Close"}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Connection status */}
              <div
                className={cn(
                  "rounded-2xl border p-4 flex flex-col sm:flex-row items-center gap-4",
                  status?.connected
                    ? "border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10"
                    : "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10"
                )}
              >
                <div className="flex-1 text-center sm:text-left">
                  <p className={cn("font-semibold flex items-center justify-center sm:justify-start gap-2",
                    status?.connected ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400")}>
                    {checking && !status ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Checking...</>
                    ) : status?.connected ? (
                      <><CheckCircle2 className="w-4 h-4" /> {t("ga_report_builder.whatsapp.connected")} ({status.state})</>
                    ) : (
                      <><AlertCircle className="w-4 h-4" /> {t("ga_report_builder.whatsapp.disconnected")}</>
                    )}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {status?.qr
                      ? "Scan the QR code below with WhatsApp (Linked Devices)."
                      : !status?.connected && status?.state === "not_configured"
                        ? <span>WhatsApp not configured for this house. <button onClick={() => setShowConnectModal(true)} className="text-green-600 dark:text-green-400 underline font-medium">Setup WhatsApp</button></span>
                        : !status?.connected && !status?.qr
                          ? t("ga_report_builder.whatsapp.no_status")
                          : "Reports are sent from this linked WhatsApp account."}
                  </p>
                </div>
                <button
                  onClick={loadStatus}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-600 text-sm hover:bg-white dark:hover:bg-slate-800 min-h-[44px]"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
              </div>

              {status?.qr && (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-4">
                  <Smartphone className="w-5 h-5 text-gray-400" />
                  <img src={status.qr} alt="WhatsApp QR" className="w-48 h-48 rounded-xl" />
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    Open WhatsApp → Linked Devices → Link a Device → Scan
                  </p>
                </div>
              )}

              {/* Group selection */}
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                  {t("ga_report_builder.whatsapp.group")}
                </label>
                {groups.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 max-h-44 overflow-y-auto pr-1">
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setChatId(g.id)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm text-left transition-colors min-h-[44px]",
                          chatId === g.id
                            ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300"
                            : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
                        )}
                      >
                        <MessageCircle className="w-4 h-4 shrink-0" />
                        <span className="truncate">{g.name}</span>
                        {chatId === g.id && <CheckCircle2 className="w-4 h-4 shrink-0 ml-auto" />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-3">
                    {t("ga_report_builder.whatsapp.no_groups")}{!status?.connected ? ` — ${t("ga_report_builder.whatsapp.disconnected")}` : ""}
                  </p>
                )}
              </div>

              {/* Format */}
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                  {t("ga_report_builder.whatsapp.format")}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {formats.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFormat(f.key)}
                      className={cn(
                        "flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-xs min-h-[44px] transition-colors",
                        format === f.key
                          ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300"
                          : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-gray-400"
                      )}
                    >
                      <f.icon className="w-4 h-4" />
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Caption */}
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                  {t("ga_report_builder.whatsapp.caption")}
                </label>
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={t("ga_report_builder.whatsapp.caption_placeholder")}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500/40"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                onClick={closeModal}
                className="px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                {t("common.cancel") || "Cancel"}
              </button>
              <button
                onClick={send}
                disabled={loading || !status?.connected}
                className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {t("ga_report_builder.whatsapp.send")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      <WhatsAppConnectModal
        open={showConnectModal}
        houseId={houseId}
        onClose={() => setShowConnectModal(false)}
        onConnected={() => { setShowConnectModal(false); loadStatus(); }}
      />
    </AnimatePresence>
  );
}
