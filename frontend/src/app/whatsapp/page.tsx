"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import {
  MessageCircle, Loader2, RefreshCw, Smartphone, CheckCircle2,
  AlertCircle, Wifi, WifiOff, Link2, RotateCcw, Settings,
  ChevronDown, Phone, X, Power, Send, Users, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import WhatsAppConnectModal from "@/components/WhatsAppConnectModal";

interface House {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
  wa_status: string | null;
  wa_phone_number: string | null;
  wa_last_connected_at: string | null;
  wa_last_error: string | null;
}

interface HouseStatus {
  house_id: number;
  connected: boolean;
  state: string;
  linked?: boolean;
  phone_number?: string;
  error?: string;
}

export default function WhatsAppPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [houses, setHouses] = useState<House[]>([]);
  const [statuses, setStatuses] = useState<Record<number, HouseStatus>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [connectModalHouse, setConnectModalHouse] = useState<number | null>(null);
  const [connectingHouse, setConnectingHouse] = useState<number | null>(null);
  const [resettingHouse, setResettingHouse] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("whatsapp.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const loadHouses = useCallback(async () => {
    try {
      const res = await apiClient.get("/houses", { params: { per_page: 100 } });
      const data = res.data?.data ?? res.data ?? [];
      const list: House[] = Array.isArray(data) ? data : [];
      setHouses(list);

      const statusMap: Record<number, HouseStatus> = {};
      await Promise.allSettled(
        list.map(async (h) => {
          try {
            const sRes = await apiClient.get("/whatsapp/status", {
              headers: { "X-House-ID": String(h.id) },
            });
            statusMap[h.id] = { house_id: h.id, ...sRes.data };
          } catch {
            statusMap[h.id] = { house_id: h.id, connected: false, state: "unreachable", error: "Service unreachable" };
          }
        })
      );
      setStatuses(statusMap);
    } catch {
      toast.error("Failed to load houses");
    }
  }, []);

  useEffect(() => {
    if (!authLoading && hasPermission("whatsapp.view")) {
      (async () => {
        setLoading(true);
        await loadHouses();
        setLoading(false);
      })();
    }
  }, [authLoading, hasPermission, loadHouses]);

  const refreshAll = async () => {
    setRefreshing(true);
    await loadHouses();
    setRefreshing(false);
    toast.success("Status refreshed");
  };

  const openConnect = (houseId: number) => {
    setConnectModalHouse(houseId);
  };

  const handleReset = async (house: House) => {
    if (!window.confirm(`Reset WhatsApp for "${house.name}"? This will disconnect the current session.`)) return;
    setResettingHouse(house.id);
    try {
      await apiClient.post(`/whatsapp/reset`, null, {
        headers: { "X-House-ID": String(house.id) },
      });
      toast.success(`WhatsApp reset for ${house.name}`);
      await loadHouses();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Reset failed");
    } finally {
      setResettingHouse(null);
    }
  };

  const handleDisconnect = async (house: House) => {
    if (!window.confirm(`Disconnect WhatsApp for "${house.name}"?`)) return;
    try {
      await apiClient.post(`/whatsapp/disconnect`, null, {
        headers: { "X-House-ID": String(house.id) },
      });
      toast.success(`Disconnected ${house.name}`);
      await loadHouses();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Disconnect failed");
    }
  };

  const handleReconnect = async (house: House) => {
    setConnectingHouse(house.id);
    try {
      const res = await apiClient.post(`/whatsapp/reconnect`, null, {
        headers: { "X-House-ID": String(house.id) },
      });
      if (res.data?.qr) {
        openConnect(house.id);
      }
      toast.success(`Reconnecting ${house.name}...`);
      await loadHouses();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Reconnect failed");
    } finally {
      setConnectingHouse(null);
    }
  };

  const getStatusIcon = (s: HouseStatus | undefined) => {
    if (!s || s.state === "unreachable") return <WifiOff className="w-4 h-4 text-gray-400" />;
    if (s.connected) return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (s.state === "not_configured") return <Settings className="w-4 h-4 text-gray-400" />;
    return <AlertCircle className="w-4 h-4 text-yellow-500" />;
  };

  const getStatusLabel = (s: HouseStatus | undefined) => {
    if (!s || s.state === "unreachable") return { text: "Unreachable", color: "text-gray-500 bg-gray-50 dark:bg-gray-500/10 dark:text-gray-400" };
    if (s.connected) return { text: "Connected", color: "text-green-700 bg-green-50 dark:bg-green-500/10 dark:text-green-400" };
    if (s.state === "not_configured") return { text: "Not Setup", color: "text-gray-500 bg-gray-50 dark:bg-gray-500/10 dark:text-gray-400" };
    if (s.state === "connecting") return { text: "Connecting...", color: "text-yellow-700 bg-yellow-50 dark:bg-yellow-500/10 dark:text-yellow-400" };
    return { text: "Disconnected", color: "text-red-700 bg-red-50 dark:bg-red-500/10 dark:text-red-400" };
  };

  if (authLoading || loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-4 w-80 bg-gray-200 dark:bg-slate-700 rounded-lg" />
          <div className="space-y-3 mt-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 bg-gray-100 dark:bg-slate-800 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!hasPermission("whatsapp.view")) {
    return <AccessDenied />;
  }

  const connectedCount = Object.values(statuses).filter((s) => s.connected).length;
  const configuredCount = Object.values(statuses).filter((s) => s.state !== "not_configured" && s.state !== "unreachable").length;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-green-100 dark:bg-green-500/20 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            WhatsApp Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-13">
            Connect and manage WhatsApp sessions per house for automated report delivery
          </p>
        </div>
        <button
          onClick={refreshAll}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50 min-h-[44px]"
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          Refresh All
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{houses.length}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total Houses</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{connectedCount}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Connected</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-yellow-50 dark:bg-yellow-500/10 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{houses.length - connectedCount}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Not Connected</p>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
              <th className="px-6 py-4 text-left">House</th>
              <th className="px-6 py-4 text-left">Status</th>
              <th className="px-6 py-4 text-left">Phone</th>
              <th className="px-6 py-4 text-left">Last Connected</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
            {houses.map((house) => {
              const s = statuses[house.id];
              const status = getStatusLabel(s);
              return (
                <tr key={house.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-500/20 flex items-center justify-center text-green-700 dark:text-green-400 shadow-sm">
                        <MessageCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{house.name}</p>
                        <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">{house.code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", status.color)}>
                      {getStatusIcon(s)}
                      {status.text}
                    </span>
                    {s?.error && s.state !== "not_configured" && (
                      <p className="text-[11px] text-red-500 mt-1 max-w-[200px] truncate" title={s.error}>{s.error}</p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {s?.phone_number ? (
                      <span className="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                        <Phone className="w-3 h-3" />
                        {s.phone_number}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {house.wa_last_connected_at ? (
                      <span className="text-xs text-gray-700 dark:text-gray-300">
                        {new Date(house.wa_last_connected_at).toLocaleDateString()} {new Date(house.wa_last_connected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Never</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      {(!s || s.state === "not_configured") ? (
                        <button
                          onClick={() => openConnect(house.id)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-all min-h-[36px]"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          Setup
                        </button>
                      ) : s.connected ? (
                        <>
                          <button
                            onClick={() => openConnect(house.id)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all min-h-[36px]"
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                            View
                          </button>
                          <button
                            onClick={() => handleDisconnect(house)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all min-h-[36px]"
                          >
                            <WifiOff className="w-3.5 h-3.5" />
                            Disconnect
                          </button>
                        </>
                      ) : s.linked === false ? (
                        <>
                          <button
                            onClick={() => openConnect(house.id)}
                            disabled={connectingHouse === house.id}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-all disabled:opacity-50 min-h-[36px]"
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                            Connect
                          </button>
                          <button
                            onClick={() => handleReset(house)}
                            disabled={resettingHouse === house.id}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all disabled:opacity-50 min-h-[36px]"
                          >
                            {resettingHouse === house.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Power className="w-3.5 h-3.5" />
                            )}
                            Reset
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleReconnect(house)}
                            disabled={connectingHouse === house.id}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-all disabled:opacity-50 min-h-[36px]"
                          >
                            {connectingHouse === house.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                            Reconnect
                          </button>
                          <button
                            onClick={() => handleReset(house)}
                            disabled={resettingHouse === house.id}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all disabled:opacity-50 min-h-[36px]"
                          >
                            {resettingHouse === house.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Power className="w-3.5 h-3.5" />
                            )}
                            Reset
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Accordion */}
      <div className="lg:hidden space-y-3">
        {houses.map((house) => {
          const s = statuses[house.id];
          const status = getStatusLabel(s);
          const isExpanded = expandedId === house.id;
          return (
            <div key={house.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : house.id)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-500/20 flex items-center justify-center text-green-700 dark:text-green-400 shrink-0">
                    <MessageCircle className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{house.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase", status.color)}>
                        {getStatusIcon(s)}
                        {status.text}
                      </span>
                      <span className="text-[10px] font-mono text-gray-400">{house.code}</span>
                    </div>
                  </div>
                </div>
                <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform duration-300", isExpanded && "rotate-180")} />
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 animate-in slide-in-from-top-1 duration-200">
                  <div className="h-px bg-gray-100 dark:bg-slate-800" />

                  {s?.phone_number && (
                    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                      <Phone className="w-3.5 h-3.5" />
                      {s.phone_number}
                    </div>
                  )}
                  {house.wa_last_connected_at && (
                    <div className="text-xs text-gray-500">
                      Last connected: {new Date(house.wa_last_connected_at).toLocaleDateString()}
                    </div>
                  )}
                  {s?.error && s.state !== "not_configured" && (
                    <p className="text-[11px] text-red-500">{s.error}</p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {(!s || s.state === "not_configured") ? (
                      <button
                        onClick={() => openConnect(house.id)}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-all min-h-[44px]"
                      >
                        <Link2 className="w-4 h-4" />
                        Setup WhatsApp
                      </button>
                    ) : s.connected ? (
                      <>
                        <button
                          onClick={() => openConnect(house.id)}
                          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 min-h-[44px]"
                        >
                          <Smartphone className="w-4 h-4" />
                          View Session
                        </button>
                        <button
                          onClick={() => handleDisconnect(house)}
                          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 min-h-[44px]"
                        >
                          <WifiOff className="w-4 h-4" />
                          Disconnect
                        </button>
                      </>
                    ) : s.linked === false ? (
                      <>
                        <button
                          onClick={() => openConnect(house.id)}
                          disabled={connectingHouse === house.id}
                          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-all disabled:opacity-50 min-h-[44px]"
                        >
                          <Smartphone className="w-4 h-4" />
                          Connect
                        </button>
                        <button
                          onClick={() => handleReset(house)}
                          disabled={resettingHouse === house.id}
                          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 min-h-[44px]"
                        >
                          {resettingHouse === house.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Power className="w-4 h-4" />
                          )}
                          Reset
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleReconnect(house)}
                          disabled={connectingHouse === house.id}
                          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-all disabled:opacity-50 min-h-[44px]"
                        >
                          {connectingHouse === house.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RotateCcw className="w-4 h-4" />
                          )}
                          Reconnect
                        </button>
                        <button
                          onClick={() => handleReset(house)}
                          disabled={resettingHouse === house.id}
                          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 min-h-[44px]"
                        >
                          {resettingHouse === house.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Power className="w-4 h-4" />
                          )}
                          Reset
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {houses.length === 0 && !loading && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-12 text-center">
          <MessageCircle className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No houses found</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Add houses first from the Houses page</p>
        </div>
      )}

      {/* Connect Modal */}
      <WhatsAppConnectModal
        open={connectModalHouse !== null}
        houseId={connectModalHouse}
        onClose={() => setConnectModalHouse(null)}
        onConnected={() => { setConnectModalHouse(null); loadHouses(); }}
      />
    </div>
  );
}
