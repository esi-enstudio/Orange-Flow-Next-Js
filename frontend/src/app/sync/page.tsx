"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";
import { CloudDownload, Loader2, Activity, Database, Zap, Building2, X } from "lucide-react";
import { toast } from "react-hot-toast";
import Cookies from "js-cookie";
import axios from "@/lib/api";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

interface HouseOption {
  id: number; name: string; code: string;
}

interface SyncCardProps {
  title: string;
  description: string;
  icon: any;
  color: string;
  bgColor: string;
  endpoint: string;
  permission: string;
  hasPermission: boolean;
  t: (key: string) => string;
  active: boolean;
  onSyncClick: (endpoint: string, label: string, bg: boolean) => void;
}

function SyncCard({ title, description, icon: Icon, color, bgColor, endpoint, hasPermission, t, active, onSyncClick }: SyncCardProps) {
  if (!hasPermission) return null;

  return (
    <div className="group/card bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6 hover:shadow-md hover:border-primary-200 dark:hover:border-primary-800/50 transition-all duration-300">
      <div className="flex items-start gap-4 mb-4">
        <div className={cn("p-3 rounded-xl transition-all duration-300 group-hover/card:scale-110 group-hover/card:shadow-sm", bgColor)}>
          <Icon className={cn("w-6 h-6 transition-all duration-300 group-hover/card:scale-110", color)} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        </div>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => onSyncClick(endpoint, title, false)}
          disabled={active}
          className="group/btn flex-1 flex cursor-pointer items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-all duration-200 shadow-lg shadow-primary-200 dark:shadow-primary-900/30 hover:shadow-xl hover:shadow-primary-300 dark:hover:shadow-primary-900/50 hover:scale-[1.02] active:scale-[0.98]"
        >
          {active ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4 transition-all duration-300 group-hover/btn:-translate-y-0.5" />}
          {active ? t('sync.syncing') : t('sync.sync_now')}
        </button>
        <button
          onClick={() => onSyncClick(endpoint, title, true)}
          disabled={active}
          className="group/btn flex cursor-pointer items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-slate-700 hover:border-gray-400 dark:hover:border-gray-500 disabled:opacity-50 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
        >
          {t('sync.sync_bg')}
        </button>
      </div>
    </div>
  );
}

export default function SyncPage() {
  const { t } = useLanguage();
  const { hasPermission } = useAuth();
  const [activeEndpoint, setActiveEndpoint] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [houseModal, setHouseModal] = useState<{ endpoint: string; label: string; bg: boolean } | null>(null);
  const pollingRef = useRef(false);

  useEffect(() => {
    axios.get("/houses/accessible").then(r => setHouses(r.data || [])).catch(() => {});
  }, []);

  const pollStatus = useCallback(async (jobId: string) => {
    pollingRef.current = true;
    const token = Cookies.get("token");

    while (pollingRef.current) {
      await new Promise(r => setTimeout(r, 2000));

      try {
        const h: Record<string, string> = {};
        if (token) h["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/sync/status/${jobId}`, { headers: h });

        if (!res.ok) {
          pollingRef.current = false;
          setActiveEndpoint(null);
          setProgressMsg(null);
          toast.error("Failed to check sync status");
          return;
        }

        const data = await res.json();

        if (data.status === "not_found") {
          pollingRef.current = false;
          setActiveEndpoint(null);
          setProgressMsg(null);
          toast.error("Sync job not found");
          return;
        }

        if (data.events?.length > 0) {
          setProgressMsg(data.events[data.events.length - 1].msg);
        }

        if (data.status === "complete") {
          pollingRef.current = false;
          setActiveEndpoint(null);
          setProgressMsg(null);
          toast.success(data.message || "Sync completed");
          return;
        }

        if (data.status === "error") {
          pollingRef.current = false;
          setActiveEndpoint(null);
          setProgressMsg(null);
          toast.error(data.message || "Sync failed");
          return;
        }
      } catch (e: any) {
        pollingRef.current = false;
        setActiveEndpoint(null);
        setProgressMsg(null);
        toast.error(e?.message || "Lost connection to sync");
        return;
      }
    }
  }, []);

  const doSync = async (endpoint: string, label: string, background: boolean, houseId: string) => {
    setActiveEndpoint(endpoint);
    setProgressMsg(`Starting ${label} sync...`);

    try {
      const token = Cookies.get("token");
      const h: Record<string, string> = {};
      if (token) h["Authorization"] = `Bearer ${token}`;
      if (houseId) h["X-House-ID"] = houseId;

      const url = `${API_BASE}${endpoint}${background ? "?background=true" : ""}`;
      const res = await fetch(url, { method: "POST", headers: h });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || err?.message || `Request failed (${res.status})`);
      }

      const data = await res.json();

      if (background) {
        toast.success(`${label}: ${t('sync.started')}`);
        setActiveEndpoint(null);
        setProgressMsg(null);
        return;
      }

      if (data.job_id) {
        pollStatus(data.job_id);
      } else {
        setActiveEndpoint(null);
        setProgressMsg(null);
        toast.success(data.message || "Sync completed");
      }
    } catch (err: any) {
      toast.error(err?.message || "Sync failed");
      setActiveEndpoint(null);
      setProgressMsg(null);
    }
  };

  const handleSyncClick = (endpoint: string, label: string, bg: boolean) => {
    setHouseModal({ endpoint, label, bg });
  };

  const handleHouseSelect = (houseId: string) => {
    const m = houseModal!;
    setHouseModal(null);
    doSync(m.endpoint, m.label, m.bg, houseId);
  };

  const modules = [
    {
      title: t('sync.activation'),
      description: t('sync.activation_desc'),
      icon: Activity,
      color: "text-primary-600",
      bgColor: "bg-primary-100 dark:bg-primary-500/20",
      endpoint: "/sync/activation",
      permission: "automation.dms_sync",
    },
    {
      title: t('sync.itopup'),
      description: t('sync.itopup_desc'),
      icon: Database,
      color: "text-emerald-600",
      bgColor: "bg-emerald-100 dark:bg-emerald-500/20",
      endpoint: "/sync/itopup",
      permission: "automation.dms_sync",
    },
    {
      title: t('sync.live_activation'),
      description: t('sync.live_activation_desc'),
      icon: Zap,
      color: "text-amber-600",
      bgColor: "bg-amber-100 dark:bg-amber-500/20",
      endpoint: "/sync/live-activation",
      permission: "automation.ga_sync",
    },
  ];

  const canView = modules.some(m => hasPermission(m.permission));
  if (!canView) return <AccessDenied />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 bg-purple-100 dark:bg-purple-500/20 rounded-xl">
          <CloudDownload className="w-5 h-5 text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('sync.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('sync.description')}</p>
        </div>
      </div>

      {progressMsg && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('sync.progress_title')}</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{progressMsg}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-2 gap-5">
        {modules.map((mod) => (
          <SyncCard
            key={mod.endpoint}
            {...mod}
            hasPermission={hasPermission(mod.permission)}
            t={t}
            active={activeEndpoint === mod.endpoint}
            onSyncClick={handleSyncClick}
          />
        ))}
      </div>

      {/* House selection modal */}
      {houseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setHouseModal(null)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border dark:border-slate-700 p-6 w-full max-w-sm mx-4">
            <button
              onClick={() => setHouseModal(null)}
              className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
              {houseModal.bg ? t('sync.sync_bg') : t('sync.sync_now')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {houseModal.label} &mdash; select a house
            </p>
            <div className="space-y-1.5">
              <button
                onClick={() => handleHouseSelect("")}
                className="flex cursor-pointer items-center gap-3 w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-slate-600"
              >
                <Building2 className="w-4 h-4 text-gray-400" />
                All Houses
              </button>
              {houses.map(h => (
                <button
                  key={h.id}
                  onClick={() => handleHouseSelect(String(h.id))}
                  className="flex cursor-pointer items-center gap-3 w-full text-left px-4 py-3 rounded-xl text-sm text-gray-700 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-slate-600"
                >
                  <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                  <span>{h.name}</span>
                  <span className="text-gray-400 text-xs ml-auto">({h.code})</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
