"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  RotateCcw,
  Unlink,
  Power,
  Smartphone,
  Link2,
  Phone,
  Settings,
  Plus,
  Trash2,
  X,
  AlertCircle,
} from "lucide-react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import WhatsAppConnectModal from "@/components/WhatsAppConnectModal";
import WhatsAppConnectionModal from "@/components/WhatsAppConnectionModal";
import type { HouseConnectionState } from "@/hooks/useHouseConnections";
import { CONNECTION_PROVIDERS } from "@/lib/connectionProviders";
import { ProviderCard } from "./ProviderCard";
import { ConnectionManagementDialog } from "./ConnectionManagementDialog";

interface Props {
  state?: HouseConnectionState;
  houseId: number;
  onChanged: () => void;
}

interface House {
  id: number;
  name: string;
  code: string;
}

interface WaConnection {
  id: number;
  name: string;
  phone_number: string | null;
  status: string;
  last_error: string | null;
  last_connected_at: string | null;
  houses: { id: number; name: string; code: string }[];
}

const btnBase =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export function WhatsAppCard({ state, houseId, onChanged }: Props) {
  const { hasPermission, user } = useAuth();
  const { t } = useLanguage();
  const canConnect = hasPermission("whatsapp.connect");
  const canDisconnect = hasPermission("whatsapp.disconnect");
  const canSetup = hasPermission("whatsapp.setup");
  const canManage = hasPermission("whatsapp.manage");
  const connected = state?.connected === true;
  const parsedConnectionId = Number(state?.reference);
  const sharedConnectionId =
    Number.isInteger(parsedConnectionId) && parsedConnectionId > 0
      ? parsedConnectionId
      : null;
  const hasSharedConnection = sharedConnectionId !== null;
  const cardState =
    hasSharedConnection &&
    (state?.status === "not_configured" || state?.status === "disconnected")
      ? { ...state, status: "ready" as const }
      : state?.status === "not_configured"
      ? { ...state, status: "disconnected" as const }
      : state;
  const headers = { "X-House-ID": String(houseId) };

  // ── Modals ──
  const [managementOpen, setManagementOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [sharedConnectOpen, setSharedConnectOpen] = useState(false);
  const [qrConnectionId, setQrConnectionId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<"disconnect" | "reset" | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [runningAction, setRunningAction] = useState<"disconnect" | "reset" | null>(null);
  const [connFormOpen, setConnFormOpen] = useState(false);
  const [connDeleteTarget, setConnDeleteTarget] = useState<WaConnection | null>(null);

  // ── Shared connections (admin) ──
  const [connections, setConnections] = useState<WaConnection[]>([]);
  const [connsLoading, setConnsLoading] = useState(false);
  const [houses, setHouses] = useState<House[]>([]);
  const [housesLoading, setHousesLoading] = useState(false);
  const [editingConnId, setEditingConnId] = useState<number | null>(null);
  const [connName, setConnName] = useState("");
  const [selectedHouseIds, setSelectedHouseIds] = useState<number[]>([]);
  const [savingConn, setSavingConn] = useState(false);
  const [deletingConnId, setDeletingConnId] = useState<number | null>(null);
  const [pendingAssignmentRefresh, setPendingAssignmentRefresh] = useState(false);
  const [skipHouseAssignmentConnectionId, setSkipHouseAssignmentConnectionId] =
    useState<number | null>(null);

  const closeManagement = () => {
    setManagementOpen(false);
    setConnectOpen(false);
    setSharedConnectOpen(false);
    setQrConnectionId(null);
    setConfirmOpen(null);
    setConnFormOpen(false);
    setConnDeleteTarget(null);
    if (pendingAssignmentRefresh) {
      setPendingAssignmentRefresh(false);
      onChanged();
    }
  };

  const loadConnections = useCallback(async () => {
    if (!canManage) return;
    setConnsLoading(true);
    try {
      const res = await apiClient.get("/whatsapp/connections");
      setConnections(res.data?.data ?? []);
    } catch {
      toast.error(t("connectionsPage.load_failed"));
    } finally {
      setConnsLoading(false);
    }
  }, [canManage, t]);

  const loadHouses = useCallback(async () => {
    if (!canManage) return null;
    setHousesLoading(true);
    try {
      const res = await apiClient.get("/houses", { params: { per_page: 100 } });
      const data = res.data?.data ?? res.data ?? [];
      const availableHouses: House[] = Array.isArray(data) ? data : [];
      setHouses(availableHouses);
      return availableHouses;
    } catch {
      toast.error(t("connectionsPage.load_failed"));
      return null;
    } finally {
      setHousesLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => {
    if (canManage) {
      void loadConnections();
      void loadHouses();
    }
  }, [canManage, loadConnections, loadHouses]);

  const startConnection = () => {
    if (!canConnect) {
      setManagementOpen(true);
      return;
    }

    if (sharedConnectionId) {
      setQrConnectionId(sharedConnectionId);
      setSharedConnectOpen(true);
      return;
    }

    if (canManage) {
      const houseName = user?.houses?.find((house) => house.id === houseId)?.name;
      setEditingConnId(null);
      setConnName(
        `${t("connectionsPage.whatsapp.name")} - ${houseName ?? houseId}`
      );
      setSelectedHouseIds([houseId]);
      setConnFormOpen(true);
      return;
    }

    setConnectOpen(true);
  };

  const editConnection = (connection: WaConnection) => {
    setEditingConnId(connection.id);
    setConnName(connection.name);
    setSelectedHouseIds(connection.houses.map((house) => house.id));
    setConnFormOpen(true);
  };

  const closeConnectionForm = () => {
    setConnFormOpen(false);
    if (pendingAssignmentRefresh) {
      setPendingAssignmentRefresh(false);
      onChanged();
    }
  };

  const handleSharedConnected = async () => {
    const activeConnectionId = qrConnectionId ?? sharedConnectionId;
    const skipHouseAssignment =
      activeConnectionId !== null &&
      activeConnectionId === skipHouseAssignmentConnectionId;
    setSharedConnectOpen(false);
    setQrConnectionId(null);
    if (skipHouseAssignment) setSkipHouseAssignmentConnectionId(null);

    if (!canManage || !activeConnectionId || skipHouseAssignment) {
      onChanged();
      return;
    }

    let availableHouses = houses;
    if (availableHouses.length === 0) {
      const loadedHouses = await loadHouses();
      if (!loadedHouses) {
        onChanged();
        return;
      }
      availableHouses = loadedHouses;
    }
    if (availableHouses.length <= 1) {
      onChanged();
      return;
    }

    let activeConnection = connections.find(
      (connection) => connection.id === activeConnectionId
    );
    if (!activeConnection) {
      try {
        const response = await apiClient.get("/whatsapp/connections");
        const refreshedConnections: WaConnection[] = response.data?.data ?? [];
        setConnections(refreshedConnections);
        activeConnection = refreshedConnections.find(
          (connection) => connection.id === activeConnectionId
        );
      } catch {
        toast.error(t("connectionsPage.load_failed"));
        onChanged();
        return;
      }
    }

    if (!activeConnection) {
      toast.error(t("connectionsPage.load_failed"));
      onChanged();
      return;
    }

    setPendingAssignmentRefresh(true);
    editConnection(activeConnection);
  };

  // ── Actions ──
  const run = async (action: "disconnect" | "reset") => {
    setConfirmOpen(null);
    setRunningAction(action);
    try {
      const path = sharedConnectionId
        ? `/whatsapp/connections/${sharedConnectionId}/${action}`
        : `/whatsapp/${action}`;
      await apiClient.post(path, null, {
        headers: sharedConnectionId ? undefined : headers,
      });
      toast.success(
        action === "reset"
          ? t("connectionsPage.whatsapp.reset_success")
          : t("connectionsPage.actions.disconnect")
      );
      onChanged();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: unknown } } })?.response
          ?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("connectionsPage.action_failed"));
    } finally {
      setRunningAction(null);
    }
  };

  const reconnect = async () => {
    setConfirmOpen(null);
    setReconnecting(true);
    try {
      const path = sharedConnectionId
        ? `/whatsapp/connections/${sharedConnectionId}/reconnect`
        : "/whatsapp/reconnect";
      await apiClient.post(path, null, {
        headers: sharedConnectionId ? undefined : headers,
      });
      toast.success(t("connectionsPage.actions.reconnect"));
      onChanged();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: unknown } } })?.response
          ?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("connectionsPage.action_failed"));
    } finally {
      setReconnecting(false);
    }
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
        await apiClient.patch(`/whatsapp/connections/${editingConnId}`, {
          name: connName.trim(),
        });
        toast.success(t("whatsappPage.updated"));
      } else {
        const response = await apiClient.post("/whatsapp/connections", {
          name: connName.trim(),
          house_ids: selectedHouseIds,
        });
        const createdConnectionId = response.data?.data?.id;
        if (!Number.isInteger(createdConnectionId) || createdConnectionId <= 0) {
          throw new Error(t("connectionsPage.save_failed"));
        }
        setSkipHouseAssignmentConnectionId(createdConnectionId);
        setQrConnectionId(createdConnectionId);
        setSharedConnectOpen(true);
        toast.success(t("whatsappPage.created"), { duration: 5000 });
      }
      setConnFormOpen(false);
      setPendingAssignmentRefresh(false);
      await loadConnections();
      onChanged();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: unknown } } })?.response?.data
          ?.detail;
      toast.error(
        typeof detail === "string" ? detail : t("connectionsPage.save_failed")
      );
    } finally {
      setSavingConn(false);
    }
  };

  const deleteConnection = async () => {
    if (!connDeleteTarget) return;
    setDeletingConnId(connDeleteTarget.id);
    try {
      await apiClient.delete(`/whatsapp/connections/${connDeleteTarget.id}`);
      toast.success(t("whatsappPage.deleted"));
      setConnDeleteTarget(null);
      await loadConnections();
      onChanged();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: unknown } } })?.response?.data
          ?.detail;
      toast.error(
        typeof detail === "string" ? detail : t("connectionsPage.delete_failed")
      );
    } finally {
      setDeletingConnId(null);
    }
  };

  // ── Render ──
  return (
    <div className="min-w-0">
      <ProviderCard
        presentation={CONNECTION_PROVIDERS.whatsapp}
        state={cardState}
        action={
          canConnect || canDisconnect || canSetup || canManage ? (
            <button
              type="button"
              onClick={() => {
                if (connected || hasSharedConnection || !canConnect) {
                  setManagementOpen(true);
                } else {
                  startConnection();
                }
              }}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Link2 className="size-4" />
              {connected || hasSharedConnection
                ? t("connectionsPage.actions.manage")
                : t("connectionsPage.actions.connect")}
            </button>
          ) : null
        }
      />

      <ConnectionManagementDialog
        open={managementOpen}
        onClose={closeManagement}
        title={t("connectionsPage.whatsapp.name")}
        description={t("connectionsPage.whatsapp.description")}
        errorMessage={state?.error}
      >
        <div className="space-y-5">
          {connected ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {canConnect && (
                <button
                  type="button"
                  onClick={reconnect}
                  disabled={confirmOpen !== null || reconnecting || runningAction !== null}
                  className={`${btnBase} w-full border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20`}
                >
                  {reconnecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  {t("connectionsPage.actions.reconnect")}
                </button>
              )}
              {canDisconnect && (
                <button
                  type="button"
                  onClick={() => setConfirmOpen("disconnect")}
                  disabled={confirmOpen !== null || runningAction !== null}
                  className={`${btnBase} w-full border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-500/10`}
                >
                  <Unlink className="size-4" />
                  {t("connectionsPage.actions.disconnect")}
                </button>
              )}
              {canSetup && (
                <button
                  type="button"
                  onClick={() => setConfirmOpen("reset")}
                  disabled={confirmOpen !== null || runningAction !== null}
                  className={`${btnBase} w-full border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800`}
                >
                  <Power className="size-4" />
                  {t("connectionsPage.actions.reset")}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {state?.status === "not_configured" && !canSetup && !sharedConnectionId
                  ? t("connectionsPage.whatsapp.setup_admin_required")
                  : t("connectionsPage.whatsapp.connect_hint")}
              </p>
              {canConnect && (state?.status !== "not_configured" || canSetup) && (
                <button
                  type="button"
                  onClick={startConnection}
                  className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700"
                >
                  <Link2 className="size-4" />
                  {t("connectionsPage.actions.connect")}
                </button>
              )}
            </div>
          )}

      {/* Admin: shared connections (whatsapp.manage) */}
      {canManage && (
        <section className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {t("whatsappPage.shared_section")}
          </h3>
            <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setEditingConnId(null);
                setConnName("");
                setSelectedHouseIds([]);
                setConnFormOpen(true);
              }}
              className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              <Plus className="size-3.5" />
              {t("whatsappPage.create_connection")}
            </button>
          </div>
          {connsLoading ? (
            <div className="h-24 rounded-xl bg-gray-100 dark:bg-slate-800 animate-pulse" />
          ) : connections.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
              {t("whatsappPage.no_connections")}
            </p>
          ) : (
            <div className="space-y-2">
              {connections.map((c) => (
                <div
                  key={c.id}
                  className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-green-100 dark:bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 shrink-0">
                      <Smartphone className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {c.name}
                      </p>
                      {c.phone_number && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                          <Phone className="w-3 h-3" /> {c.phone_number}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      c.status === "connected"
                        ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                        : "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-300"
                    }`}
                  >
                    {c.status === "connected" ? t("connectionsPage.status.connected") : t("connectionsPage.status.disconnected")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingConnId(c.id);
                      setConnName(c.name);
                      setSelectedHouseIds(c.houses.map((h) => h.id));
                      setConnFormOpen(true);
                    }}
                    className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-gray-400 transition-colors hover:text-primary-600 dark:hover:text-primary-400"
                    title={t("whatsappPage.manage_houses")}
                    aria-label={t("whatsappPage.manage_houses")}
                  >
                    <Settings className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnDeleteTarget(c)}
                    className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-gray-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
                    title={t("whatsappPage.delete_connection")}
                    aria-label={t("whatsappPage.delete_connection")}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {housesLoading ? (
            <p className="text-xs text-gray-400 text-center py-2">{t("connectionsPage.loading_houses")}</p>
          ) : null}
        </section>
      )}
        </div>
      </ConnectionManagementDialog>

      <WhatsAppConnectModal
        open={connectOpen}
        houseId={houseId}
        onClose={() => setConnectOpen(false)}
        onConnected={() => {
          setConnectOpen(false);
          onChanged();
        }}
      />

      <WhatsAppConnectionModal
        open={sharedConnectOpen}
        connectionId={qrConnectionId ?? sharedConnectionId}
        onClose={() => {
          const createdForThisHouse =
            qrConnectionId !== null && qrConnectionId !== sharedConnectionId;
          setSharedConnectOpen(false);
          setQrConnectionId(null);
          if (createdForThisHouse) onChanged();
        }}
        onConnected={handleSharedConnected}
      />

      <ConfirmationModal
        isOpen={confirmOpen === "disconnect" || confirmOpen === "reset"}
        onClose={() => setConfirmOpen(null)}
        onConfirm={() => {
          const action = confirmOpen === "reset" ? "reset" : "disconnect";
          void run(action);
        }}
        title={
          confirmOpen === "reset"
            ? t(
                sharedConnectionId
                  ? "connectionsPage.whatsapp.shared_reset_title"
                  : "connectionsPage.whatsapp.reset_title"
              )
            : t(
                sharedConnectionId
                  ? "connectionsPage.whatsapp.shared_disconnect_title"
                  : "connectionsPage.whatsapp.disconnect_title"
              )
        }
        message={
          confirmOpen === "reset"
            ? t(
                sharedConnectionId
                  ? "connectionsPage.whatsapp.shared_reset_desc"
                  : "connectionsPage.whatsapp.reset_desc"
              )
            : t(
                sharedConnectionId
                  ? "connectionsPage.whatsapp.shared_disconnect_desc"
                  : "connectionsPage.whatsapp.disconnect_desc"
              )
        }
        confirmText={
          confirmOpen === "reset"
            ? t("connectionsPage.actions.reset")
            : t("connectionsPage.actions.disconnect")
        }
        cancelText={t("connectionsPage.actions.cancel")}
        type="danger"
        loading={runningAction !== null}
      />

      {/* Connection create/edit modal */}
      {connFormOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-md p-4"
          onClick={closeConnectionForm}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-gray-200 dark:border-slate-700 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900 dark:text-gray-100">
                  {editingConnId ? t("whatsappPage.manage_houses") : t("whatsappPage.create_connection")}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("whatsappPage.shared_desc")}
                </p>
              </div>
              <button
                onClick={closeConnectionForm}
                className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800"
                aria-label={t("connectionsPage.actions.close")}
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
                        <p className="text-sm text-gray-700 dark:text-gray-200 truncate">
                          {h.name}
                        </p>
                        <p className="text-[10px] font-mono text-gray-400">
                          {h.code}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={saveConnection}
                disabled={savingConn || !connName.trim() || selectedHouseIds.length === 0}
                className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingConn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Link2 className="w-4 h-4" />
                )}
                {editingConnId
                  ? t("whatsappPage.updated")
                  : t("whatsappPage.create_connection")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={connDeleteTarget !== null}
        onClose={() => setConnDeleteTarget(null)}
        onConfirm={deleteConnection}
        type="danger"
        title={t("whatsappPage.delete_title")}
        confirmText={t("whatsappPage.delete_connection")}
        loading={deletingConnId !== null}
      >
        {connDeleteTarget && (
          <>
            <div className="w-full mt-5 rounded-2xl border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 p-4">
              <div className="flex items-center gap-3 text-left">
                <div className="w-11 h-11 rounded-xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm">
                  <Smartphone className="w-5 h-5 text-green-600 dark:text-green-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {connDeleteTarget.name}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 font-mono">
                    <Phone className="w-3 h-3" />
                    {connDeleteTarget.phone_number || "—"}
                  </p>
                </div>
              </div>
            </div>
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
