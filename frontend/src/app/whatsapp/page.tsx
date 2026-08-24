"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import {
  MessageCircle, Loader2, RefreshCw, Smartphone, CheckCircle2,
  AlertCircle, WifiOff, Link2, RotateCcw, Settings,
  ChevronDown, Phone, X, Power, Share2, Plus, Unlink, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import WhatsAppConnectModal from "@/components/WhatsAppConnectModal";
import WhatsAppConnectionModal from "@/components/WhatsAppConnectionModal";

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
  mode?: string;
  connection?: { id: number; name: string; phone_number?: string | null } | null;
  last_connected_at?: string | null;
  error?: string;
}

interface WaConnection {
  id: number;
  name: string;
  phone_number: string | null;
  status: string;
  last_error: string | null;
  last_connected_at: string | null;
  created_at: string | null;
  houses: { id: number; name: string; code: string }[];
}

export default function WhatsAppPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [houses, setHouses] = useState<House[]>([]);
  const [statuses, setStatuses] = useState<Record<number, HouseStatus>>({});
  const [connections, setConnections] = useState<WaConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [connectModalHouse, setConnectModalHouse] = useState<number | null>(null);
  const [connectingHouse, setConnectingHouse] = useState<number | null>(null);
  const [resettingHouse, setResettingHouse] = useState<number | null>(null);

  // Shared connections
  const [connectModalConn, setConnectModalConn] = useState<number | null>(null);
  const [showConnForm, setShowConnForm] = useState(false);
  const [editingConnId, setEditingConnId] = useState<number | null>(null);
  const [connName, setConnName] = useState("");
  const [selectedHouseIds, setSelectedHouseIds] = useState<number[]>([]);
  const [savingConn, setSavingConn] = useState(false);
  const [deletingConnId, setDeletingConnId] = useState<number | null>(null);
  const [deleteConnTarget, setDeleteConnTarget] = useState<WaConnection | null>(null);

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

  const loadConnections = useCallback(async () => {
    try {
      const res = await apiClient.get("/whatsapp/connections");
      setConnections(res.data?.data ?? []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    if (!authLoading && hasPermission("whatsapp.view")) {
      (async () => {
        setLoading(true);
        await Promise.all([loadHouses(), loadConnections()]);
        setLoading(false);
      })();
    }
  }, [authLoading, hasPermission, loadHouses, loadConnections]);

  const refreshAll = async () => {
    setRefreshing(true);
    await Promise.all([loadHouses(), loadConnections()]);
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
      await Promise.all([loadHouses(), loadConnections()]);
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
      await Promise.all([loadHouses(), loadConnections()]);
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

  // ── Shared connections ────────────────────────────────────────────

  const openCreateConn = () => {
    setEditingConnId(null);
    setConnName("");
    setSelectedHouseIds([]);
    setShowConnForm(true);
  };

  const openManageConn = (c: WaConnection) => {
    setEditingConnId(c.id);
    setConnName(c.name);
    setSelectedHouseIds(c.houses.map((h) => h.id));
    setShowConnForm(true);
  };

  const toggleHouseSelection = (id: number) => {
    setSelectedHouseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const saveConnection = async () => {
    if (!connName.trim()) {
      toast.error(t("whatsappPage.connection_name"));
      return;
    }
    if (selectedHouseIds.length === 0) {
      toast.error(t("whatsappPage.select_house_error"));
      return;
    }
    setSavingConn(true);
    try {
      if (editingConnId) {
        await apiClient.put(`/whatsapp/connections/${editingConnId}/houses`, {
          house_ids: selectedHouseIds,
        });
        await apiClient.patch(`/whatsapp/connections/${editingConnId}`, { name: connName.trim() });
        toast.success(t("whatsappPage.updated"));
        setShowConnForm(false);
        await loadConnections();
      } else {
        await apiClient.post("/whatsapp/connections", {
          name: connName.trim(),
          house_ids: selectedHouseIds,
        });
        toast.success(t("whatsappPage.created"), { duration: 5000 });
        setShowConnForm(false);
        await loadConnections();
      }
      await loadHouses();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to save connection");
    } finally {
      setSavingConn(false);
    }
  };

  const deleteConnection = async () => {
    if (!deleteConnTarget) return;
    setDeletingConnId(deleteConnTarget.id);
    try {
      await apiClient.delete(`/whatsapp/connections/${deleteConnTarget.id}`);
      toast.success(t("whatsappPage.deleted"));
      setDeleteConnTarget(null);
      await Promise.all([loadConnections(), loadHouses()]);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    } finally {
      setDeletingConnId(null);
    }
  };

  // ── Status helpers ───────────────────────────────────────────────

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

  const getConnStatusLabel = (status: string | null) => {
    switch (status) {
      case "connected": return { text: "Connected", color: "text-green-700 bg-green-50 dark:bg-green-500/10 dark:text-green-400" };
      case "connecting": return { text: "Connecting...", color: "text-yellow-700 bg-yellow-50 dark:bg-yellow-500/10 dark:text-yellow-400" };
      case "error": return { text: "Error", color: "text-red-700 bg-red-50 dark:bg-red-500/10 dark:text-red-400" };
      default: return { text: "Disconnected", color: "text-gray-500 bg-gray-50 dark:bg-gray-500/10 dark:text-gray-400" };
    }
  };

  const canManage = hasPermission("whatsapp.manage");

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

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-green-100 dark:bg-green-500/20 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            {t("whatsappPage.title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-13">
            {t("whatsappPage.subtitle")}
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
              <Share2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{connections.length}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("whatsappPage.shared_section")}</p>
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
      </div>

      {/* ── Shared Connections ── */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Share2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              {t("whatsappPage.shared_section")}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("whatsappPage.shared_desc")}</p>
          </div>
          {canManage && (
            <button
              onClick={openCreateConn}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              {t("whatsappPage.create_connection")}
            </button>
          )}
        </div>

        {connections.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 p-8 text-center">
            <Share2 className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-gray-500 dark:text-gray-400 font-medium text-sm">{t("whatsappPage.no_connections")}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("whatsappPage.no_connections_hint")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {connections.map((c) => {
              const st = getConnStatusLabel(c.status);
              return (
                <div key={c.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0",
                        c.status === "connected"
                          ? "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400"
                          : "bg-gray-100 dark:bg-slate-800 text-gray-500"
                      )}>
                        <MessageCircle className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{c.name}</p>
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider mt-1",
                          st.color
                        )}>
                          {st.text}
                        </span>
                      </div>
                    </div>
                    {c.phone_number && (
                      <span className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1 shrink-0">
                        <Phone className="w-3 h-3" />
                        {c.phone_number}
                      </span>
                    )}
                  </div>

                  {c.last_error && c.status !== "connected" && (
                    <p className="text-[11px] text-red-500 line-clamp-2">{c.last_error}</p>
                  )}

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                      {t("whatsappPage.assigned_houses")} ({c.houses.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {c.houses.length === 0 && (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                      {c.houses.map((h) => (
                        <span key={h.id} className="inline-flex items-center px-2 py-1 rounded-lg bg-gray-50 dark:bg-slate-800 text-[11px] text-gray-600 dark:text-gray-300 max-w-full">
                          <span className="truncate">{h.name}</span>
                          <span className="ml-1 font-mono text-[9px] text-gray-400">{h.code}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => setConnectModalConn(c.id)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-all min-h-[36px]"
                    >
                      {c.status === "connected" ? <Smartphone className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
                      {c.status === "connected" ? "View" : "Connect"}
                    </button>
                    {canManage && (
                      <>
                        <button
                          onClick={() => openManageConn(c)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all min-h-[36px]"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          {t("whatsappPage.manage_houses")}
                        </button>
                        <button
                          onClick={() => setDeleteConnTarget(c)}
                          disabled={deletingConnId === c.id}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all min-h-[36px] disabled:opacity-50 ml-auto"
                        >
                          {deletingConnId === c.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Power className="w-3.5 h-3.5" />
                          )}
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Per-House Devices ── */}
      <div className="space-y-4 pt-2">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          {t("whatsappPage.houses_tab")}
        </h2>

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
              const isShared = s?.mode === "connection";
              return (
                <tr key={house.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-2 py-1 md:px-6 md:py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-500/20 flex items-center justify-center text-green-700 dark:text-green-400 shadow-sm shrink-0">
                        <MessageCircle className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{house.name}</p>
                        <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">{house.code}</p>
                        {isShared && s?.connection && (
                          <p className="text-[10px] text-purple-600 dark:text-purple-400 mt-0.5 flex items-center gap-1">
                            <Share2 className="w-3 h-3" />
                            {s.connection.name}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", status.color)}>
                      {getStatusIcon(s)}
                      {isShared ? t("whatsappPage.shared_badge") : status.text}
                    </span>
                    {!isShared && s?.error && s.state !== "not_configured" && (
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
                    {s?.last_connected_at ? (
                      <span className="text-xs text-gray-700 dark:text-gray-300">
                        {new Date(s.last_connected_at).toLocaleDateString()} {new Date(s.last_connected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Never</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      {isShared ? (
                        <span className="text-[11px] text-gray-400 italic">via shared connection</span>
                      ) : (!s || s.state === "not_configured") ? (
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
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all min-h-[36px] disabled:opacity-50"
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
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all min-h-[36px] disabled:opacity-50"
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
          const isShared = s?.mode === "connection";
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
                        {isShared ? t("whatsappPage.shared_badge") : status.text}
                      </span>
                      <span className="text-[10px] font-mono text-gray-400">{house.code}</span>
                    </div>
                    {isShared && s?.connection && (
                      <p className="text-[10px] text-purple-600 dark:text-purple-400 mt-0.5 flex items-center gap-1">
                        <Share2 className="w-3 h-3" />
                        {s.connection.name}
                      </p>
                    )}
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
                  {s?.last_connected_at && (
                    <div className="text-xs text-gray-500">
                      Last connected: {new Date(s.last_connected_at).toLocaleDateString()}
                    </div>
                  )}
                  {!isShared && s?.error && s.state !== "not_configured" && (
                    <p className="text-[11px] text-red-500">{s.error}</p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {isShared ? (
                      s?.connection && (
                        <button
                          onClick={() => setConnectModalConn(s.connection!.id)}
                          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 min-h-[44px]"
                        >
                          <Smartphone className="w-4 h-4" />
                          View Shared Connection
                        </button>
                      )
                    ) : (!s || s.state === "not_configured") ? (
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
      </div>

      {houses.length === 0 && !loading && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-12 text-center">
          <MessageCircle className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No houses found</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Add houses first from the Houses page</p>
        </div>
      )}

      {/* Connection create/edit modal */}
      {showConnForm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-md p-4"
          onClick={() => setShowConnForm(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-gray-200 dark:border-slate-700/80 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center shrink-0">
                <Share2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900 dark:text-gray-100">
                  {editingConnId ? t("whatsappPage.manage_houses") : t("whatsappPage.create_connection")}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("whatsappPage.shared_desc")}</p>
              </div>
              <button
                onClick={() => setShowConnForm(false)}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                  {t("whatsappPage.connection_name")}
                </label>
                <input
                  type="text"
                  value={connName}
                  onChange={(e) => setConnName(e.target.value)}
                  placeholder={t("whatsappPage.connection_name_placeholder")}
                  maxLength={200}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                  {t("whatsappPage.assign_houses")} ({selectedHouseIds.length}/{houses.length})
                </label>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800">
                  {houses.map((h) => (
                    <label
                      key={h.id}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedHouseIds.includes(h.id)}
                        onChange={() => toggleHouseSelection(h.id)}
                        className="w-4 h-4 accent-purple-600"
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-gray-700 dark:text-gray-200 truncate">{h.name}</p>
                        <p className="text-[10px] font-mono text-gray-400">{h.code}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={saveConnection}
                disabled={savingConn || !connName.trim() || selectedHouseIds.length === 0}
                className="w-full flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                {savingConn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {editingConnId
                  ? t("whatsappPage.updated")
                  : t("whatsappPage.create_connection")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Per-house Connect Modal */}
      <WhatsAppConnectModal
        open={connectModalHouse !== null}
        houseId={connectModalHouse}
        onClose={() => setConnectModalHouse(null)}
        onConnected={() => { setConnectModalHouse(null); loadHouses(); }}
      />

      {/* Shared connection QR Modal */}
      <WhatsAppConnectionModal
        open={connectModalConn !== null}
        connectionId={connectModalConn}
        onClose={() => setConnectModalConn(null)}
        onConnected={() => { setConnectModalConn(null); Promise.all([loadConnections(), loadHouses()]); }}
      />

      {/* Shared Connection Delete Confirmation */}
      <ConfirmationModal
        isOpen={deleteConnTarget !== null}
        onClose={() => setDeleteConnTarget(null)}
        onConfirm={deleteConnection}
        type="danger"
        title={t("whatsappPage.delete_title")}
        confirmText={t("whatsappPage.delete_connection")}
        loading={deletingConnId !== null}
      >
        {deleteConnTarget && (
          <>
            {/* Connection summary card */}
            <div className="w-full mt-5 rounded-2xl border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 p-4">
              <div className="flex items-center gap-3 text-left">
                <div className="w-11 h-11 rounded-xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm">
                  <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {deleteConnTarget.name}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 font-mono">
                    <Phone className="w-3 h-3" />
                    {deleteConnTarget.phone_number || "—"}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide shrink-0",
                    deleteConnTarget.status === "connected"
                      ? "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400"
                      : "bg-gray-100 dark:bg-slate-700/60 text-gray-500 dark:text-gray-400"
                  )}
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      deleteConnTarget.status === "connected" ? "bg-green-500" : "bg-gray-400"
                    )}
                  />
                  {deleteConnTarget.status}
                </span>
              </div>
            </div>

            {/* Consequences */}
            <ul className="w-full mt-5 space-y-2.5 text-left">
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-red-100 dark:bg-red-500/15 flex items-center justify-center shrink-0">
                  <X className="w-3 h-3 text-red-600 dark:text-red-400" />
                </span>
                <span className="text-sm text-gray-700 dark:text-gray-300 leading-snug">
                  {t("whatsappPage.delete_will_disconnect")}
                </span>
              </li>
              {deleteConnTarget.houses.length > 0 && (
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-red-100 dark:bg-red-500/15 flex items-center justify-center shrink-0">
                    <Unlink className="w-3 h-3 text-red-600 dark:text-red-400" />
                  </span>
                  <span className="text-sm text-gray-700 dark:text-gray-300 leading-snug">
                    {t("whatsappPage.delete_unbind_houses", {
                      count: deleteConnTarget.houses.length,
                      s: deleteConnTarget.houses.length === 1 ? "" : "s",
                    })}
                  </span>
                </li>
              )}
            </ul>

            {/* Affected houses chips */}
            {deleteConnTarget.houses.length > 0 ? (
              <>
                <div className="w-full max-h-28 overflow-y-auto flex flex-wrap justify-start gap-1.5 mt-4 p-0.5">
                  {deleteConnTarget.houses.map((h) => (
                    <span
                      key={h.id}
                      title={`${h.name} (${h.code})`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 text-[11px] text-gray-600 dark:text-gray-300 max-w-full"
                    >
                      <span className="truncate">{h.name}</span>
                      <span className="font-mono text-[9px] text-gray-400">{h.code}</span>
                    </span>
                  ))}
                </div>
                <p className="w-full mt-3 text-xs text-gray-500 dark:text-gray-400 leading-relaxed flex items-start gap-1.5 text-left">
                  <Info className="w-3.5 h-3.5 mt-px shrink-0 text-blue-500" />
                  {t("whatsappPage.delete_fallback_note")}
                </p>
              </>
            ) : (
              <p className="w-full mt-4 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 text-left">
                <Info className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                {t("whatsappPage.delete_no_houses_note")}
              </p>
            )}

            {/* Irreversible warning */}
            <p className="mt-4 pt-4 w-full border-t border-dashed border-gray-200 dark:border-slate-700 text-xs font-semibold text-red-600 dark:text-red-400 flex items-center justify-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {t("whatsappPage.delete_irreversible")}
            </p>
          </>
        )}
      </ConfirmationModal>
    </div>
  );
}
