"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Copy, Check, Clock, RefreshCw, KeyRound } from "lucide-react";
import apiClient from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";

const OTP_EXPIRY_SECONDS = 120; // OTPs older than 2 minutes fade out to show they have expired

interface OTPItem {
  id: number;
  otp_code: string;
  house_id: number | null;
  house_code: string;
  house_name: string;
  sender: string | null;
  message: string | null;
  received_at: string | null;
  is_used: boolean;
  used_at: string | null;
}

interface OtpPanelProps {
  houseId?: string;
}

export default function OtpPanel({ houseId }: OtpPanelProps) {
  const { t } = useLanguage();
  const [items, setItems] = useState<OTPItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const fetchOtp = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (houseId) headers["X-House-ID"] = String(houseId);
      const res = await apiClient.get("otp", { headers, params: { limit: 10 } });
      setItems(res.data?.data || []);
    } catch {
      // keep previous data on transient errors
    } finally {
      setLoading(false);
    }
  }, [houseId]);

  useEffect(() => {
    fetchOtp();
    const interval = setInterval(fetchOtp, 5000);
    return () => clearInterval(interval);
  }, [fetchOtp]);

  useEffect(() => {
    if (copiedId == null) return;
    const t = setTimeout(() => setCopiedId(null), 1600);
    return () => clearTimeout(t);
  }, [copiedId]);

  const copy = async (item: OTPItem) => {
    try {
      await navigator.clipboard.writeText(item.otp_code);
      setCopiedId(item.id);
    } catch {
      // clipboard unavailable
    }
  };

  const elapsed = (iso: string | null) => {
    if (!iso) return "";
    const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${Math.floor(diff)}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    return `${Math.floor(diff / 3600)}h`;
  };

  const isExpired = (iso: string | null) => {
    if (!iso) return false;
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    return diff > OTP_EXPIRY_SECONDS;
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm transition-colors duration-300">
      <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold flex items-center gap-2 dark:text-gray-100">
              {t("otp.panel_title")}
              {items.length > 0 && (
                <span className="text-xs font-bold bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">
                  {t("otp.live")}
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t("otp.panel_subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchOtp}
            className="p-2 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
            aria-label={t("otp.refresh")}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <PageGuideModal pageKey="otp" />
        </div>
      </div>

      <div className="divide-y divide-gray-50 dark:divide-slate-800">
        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <ShieldCheck className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("otp.no_data")}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("otp.no_data_hint")}</p>
          </div>
        ) : (
          items.map((item) => {
            const expired = isExpired(item.received_at);
            return (
              <div
                key={item.id}
                className={`flex items-center gap-4 px-6 py-4 transition-all duration-500 ${
                  expired
                    ? "opacity-40 grayscale hover:opacity-60"
                    : "hover:bg-gray-50/50 dark:hover:bg-slate-800/50"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-sm font-bold tracking-widest ${
                        expired
                          ? "text-gray-400 dark:text-gray-500"
                          : "text-gray-900 dark:text-gray-100"
                      }`}
                    >
                      {item.otp_code}
                    </span>
                    {item.is_used && (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400">
                        {t("otp.used")}
                      </span>
                    )}
                    {expired && (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400">
                        {t("otp.expired")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                    <span className="text-[11px] font-medium text-primary-600 dark:text-primary-400">
                      {item.house_name
                        ? item.house_code
                          ? `${item.house_name} (${item.house_code})`
                          : item.house_name
                        : item.house_code}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {elapsed(item.received_at)} {t("otp.ago")}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => copy(item)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  {copiedId === item.id ? (
                    <Check className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedId === item.id ? t("otp.copied") : t("otp.copy")}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
