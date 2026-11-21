"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, Unlink, Link2 } from "lucide-react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import WhatsAppConnectionModal from "@/components/WhatsAppConnectionModal";
import type { HouseConnectionState } from "@/hooks/useHouseConnections";
import { CONNECTION_PROVIDERS } from "@/lib/connectionProviders";
import { ProviderCard } from "./ProviderCard";
import { ConnectionManagementDialog } from "./ConnectionManagementDialog";

const iconActionBase =
  "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border transition-colors disabled:cursor-not-allowed disabled:opacity-60";

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
  created_by: number | null;
  houses: { id: number; name: string; code: string }[];
}

function errorMessage(error: unknown, fallback: string): string {
  const detail = (
    error as { response?: { data?: { detail?: unknown } } }
  )?.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}

export function WhatsAppCard({ state, houseId, onChanged }: Props) {
  const { hasPermission, user } = useAuth();
  const { t } = useLanguage();
  const canConnect = hasPermission("whatsapp.connect");
  const canDisconnect = hasPermission("whatsapp.disconnect");
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
  const [sharedConnectOpen, setSharedConnectOpen] = useState(false);
  const [qrConnectionId, setQrConnectionId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<"disconnect" | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [runningAction, setRunningAction] = useState<"disconnect" | null>(null);
  const [preparingConnect, setPreparingConnect] = useState(false);
  const [housePickerOpen, setHousePickerOpen] = useState(false);
  const [housePickerConnection, setHousePickerConnection] = useState<WaConnection | null>(null);
  const [savingHouses, setSavingHouses] = useState(false);

  // ── Shared connections (admin) ──
  const [connections, setConnections] = useState<WaConnection[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [housesLoading, setHousesLoading] = useState(false);
  const [selectedHouseIds, setSelectedHouseIds] = useState<number[]>([]);
  const [assignHouseIds, setAssignHouseIds] = useState<number[]>([]);
  const [savingAssign, setSavingAssign] = useState(false);

  const closeManagement = () => {
    setManagementOpen(false);
    setSharedConnectOpen(false);
    setQrConnectionId(null);
    setConfirmOpen(null);
  };

  const loadConnections = useCallback(async () => {
    if (!canManage && !canConnect) return;
    try {
      const res = await apiClient.get("/whatsapp/connections");
      setConnections(res.data?.data ?? []);
    } catch {
      toast.error(t("connectionsPage.load_failed"));
    }
  }, [canConnect, canManage, t]);

  const canListHouses = hasPermission("houses.view");

  const loadHouses = useCallback(async () => {
    if (!canManage && !canConnect) return null;
    // Roles that may connect but lack houses.view (e.g. Manager) can only
    // assign their own houses, so use those instead of the houses endpoint.
    if (!canListHouses) {
      const ownHouses: House[] = (user?.houses ?? []).map((house) => ({
        id: house.id,
        name: house.name,
        code: house.code,
      }));
      setHouses(ownHouses);
      return ownHouses;
    }
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
  }, [canConnect, canListHouses, canManage, t, user?.houses]);

  useEffect(() => {
    if (canManage || canConnect) {
      void loadConnections();
      void loadHouses();
    }
  }, [canConnect, canManage, loadConnections, loadHouses]);

  /** Open the house picker for a connection that is ready to serve houses. */
  const openHousePicker = useCallback(
    async (connection: WaConnection) => {
      setManagementOpen(false);
      setHousePickerConnection(connection);
      setSelectedHouseIds(
        connection.houses.length > 0
          ? connection.houses.map((house) => house.id)
          : [houseId]
      );
      setHousePickerOpen(true);
      if (houses.length === 0) await loadHouses();
    },
    [houseId, houses.length, loadHouses]
  );

  /**
   * QR-first connect: reuse the user's unassigned draft, otherwise create a
   * house-less connection, then open the scan dialog. Houses are chosen after
   * the device is linked.
   */
  const startConnection = async () => {
    if (!canConnect) {
      setManagementOpen(true);
      return;
    }

    if (sharedConnectionId) {
      setQrConnectionId(sharedConnectionId);
      setSharedConnectOpen(true);
      return;
    }

    setPreparingConnect(true);
    try {
      let available = connections;
      try {
        const res = await apiClient.get("/whatsapp/connections");
        available = res.data?.data ?? [];
        setConnections(available);
      } catch {
        /* fall back to the cached list */
      }

      let connection =
        available.find(
          (item) => item.houses.length === 0 && item.created_by === user?.id
        ) ?? null;

      if (!connection) {
        const houseName = user?.houses?.find((house) => house.id === houseId)?.name;
        const res = await apiClient.post("/whatsapp/connections", {
          name: `${t("connectionsPage.whatsapp.name")} - ${houseName ?? houseId}`,
          house_ids: [],
        });
        connection = res.data?.data ?? null;
        if (!connection?.id) {
          throw new Error(t("connectionsPage.whatsapp.start_failed"));
        }
        setConnections((previous) => [
          ...previous.filter((item) => item.id !== connection!.id),
          connection!,
        ]);
      }

      setQrConnectionId(connection.id);
      setSharedConnectOpen(true);
    } catch (error: unknown) {
      toast.error(
        errorMessage(error, t("connectionsPage.whatsapp.start_failed"))
      );
    } finally {
      setPreparingConnect(false);
    }
  };

  const handleSharedConnected = async () => {
    const activeConnectionId = qrConnectionId ?? sharedConnectionId;
    setSharedConnectOpen(false);
    setQrConnectionId(null);
    if (!activeConnectionId) {
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

    // Do not refresh the page state here: it unmounts this card (and the
    // house picker) while the user is still choosing houses.
    if (!activeConnection) {
      onChanged();
      return;
    }
    await openHousePicker(activeConnection);
  };

  const saveConnectionHouses = async () => {
    if (!housePickerConnection) return;
    if (selectedHouseIds.length === 0) {
      toast.error(t("connectionsPage.whatsapp.need_house"));
      return;
    }
    setSavingHouses(true);
    try {
      await apiClient.put(
        `/whatsapp/connections/${housePickerConnection.id}/houses`,
        { house_ids: selectedHouseIds }
      );
      toast.success(t("connectionsPage.whatsapp.houses_saved"));
      setHousePickerOpen(false);
      setHousePickerConnection(null);
      await loadConnections();
      onChanged();
    } catch (error: unknown) {
      toast.error(errorMessage(error, t("connectionsPage.save_failed")));
    } finally {
      setSavingHouses(false);
    }
  };

  /** Persist the house selection made inside the manage dialog. */
  const saveAssignedHouses = async () => {
    if (!sharedConnectionId) return;
    if (assignHouseIds.length === 0) {
      toast.error(t("connectionsPage.whatsapp.need_house"));
      return;
    }
    setSavingAssign(true);
    try {
      await apiClient.put(`/whatsapp/connections/${sharedConnectionId}/houses`, {
        house_ids: assignHouseIds,
      });
      toast.success(t("connectionsPage.whatsapp.houses_saved"));
      await loadConnections();
      onChanged();
    } catch (error: unknown) {
      toast.error(errorMessage(error, t("connectionsPage.save_failed")));
    } finally {
      setSavingAssign(false);
    }
  };

  const toggleAssignHouse = (id: number) => {
    setAssignHouseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // ── Actions ──
  const disconnect = async () => {
    setConfirmOpen(null);
    setRunningAction("disconnect");
    try {
      const path = sharedConnectionId
        ? `/whatsapp/connections/${sharedConnectionId}/disconnect`
        : "/whatsapp/disconnect";
      await apiClient.post(path, null, {
        headers: sharedConnectionId ? undefined : headers,
      });
      toast.success(t("connectionsPage.whatsapp.modal.disconnect_success"));
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

  const activeSharedConnection =
    sharedConnectionId !== null
      ? connections.find((connection) => connection.id === sharedConnectionId) ?? null
      : null;
  const canAssignHouses =
    activeSharedConnection !== null &&
    (canManage || activeSharedConnection.created_by === user?.id);
  const assignedHouseKey = activeSharedConnection
    ? activeSharedConnection.houses
        .map((house) => house.id)
        .sort((a, b) => a - b)
        .join(",")
    : "";

  // Seed the house checkboxes from the connection every time the dialog opens
  // (and whenever the saved assignment changes).
  useEffect(() => {
    if (!managementOpen) return;
    setAssignHouseIds(
      activeSharedConnection?.houses.map((house) => house.id) ?? []
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managementOpen, assignedHouseKey]);

  // ── Render ──
  return (
    <div className="min-w-0">
      <ProviderCard
        presentation={CONNECTION_PROVIDERS.whatsapp}
        state={cardState}
        action={
          canConnect || canDisconnect || canManage ? (
            <button
              type="button"
              onClick={() => {
                if (connected || hasSharedConnection || !canConnect) {
                  setManagementOpen(true);
                } else {
                  void startConnection();
                }
              }}
              disabled={preparingConnect}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {preparingConnect ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              {preparingConnect
                ? t("connectionsPage.whatsapp.preparing")
                : connected || hasSharedConnection
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
          {!connected && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("connectionsPage.whatsapp.connect_hint")}
              </p>
              {canConnect && (
                <button
                  type="button"
                  onClick={() => void startConnection()}
                  disabled={preparingConnect}
                  className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {preparingConnect ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Link2 className="size-4" />
                  )}
                  {preparingConnect
                    ? t("connectionsPage.whatsapp.preparing")
                    : t("connectionsPage.actions.connect")}
                </button>
              )}
            </div>
          )}

          {/* Shared connection: choose which of my houses use this number */}
          {activeSharedConnection && (
            <section className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {t("whatsappPage.shared_section")}
                  </h3>
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    <span className="min-w-0 truncate">
                      {activeSharedConnection.name}
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                        activeSharedConnection.status === "connected"
                          ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                          : "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-300"
                      }`}
                    >
                      {activeSharedConnection.status === "connected"
                        ? t("connectionsPage.status.connected")
                        : t("connectionsPage.status.disconnected")}
                    </span>
                  </p>
                  {activeSharedConnection.phone_number && (
                    <p className="truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
                      {activeSharedConnection.phone_number}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {connected && canConnect && (
                    <button
                      type="button"
                      onClick={reconnect}
                      disabled={
                        confirmOpen !== null ||
                        reconnecting ||
                        runningAction !== null
                      }
                      className={`${iconActionBase} border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20`}
                      title={t("connectionsPage.actions.reconnect")}
                      aria-label={t("connectionsPage.actions.reconnect")}
                    >
                      {reconnecting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RotateCcw className="size-4" />
                      )}
                    </button>
                  )}
                  {connected && canDisconnect && (
                    <button
                      type="button"
                      onClick={() => setConfirmOpen("disconnect")}
                      disabled={confirmOpen !== null || runningAction !== null}
                      className={`${iconActionBase} border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-500/10`}
                      title={t("connectionsPage.actions.disconnect")}
                      aria-label={t("connectionsPage.actions.disconnect")}
                    >
                      <Unlink className="size-4" />
                    </button>
                  )}
                </div>
              </div>

              {canAssignHouses && (
                <>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t("connectionsPage.whatsapp.houses_desc")}
                  </p>

                  <div className="max-h-64 divide-y divide-gray-50 overflow-y-auto rounded-xl border border-gray-100 dark:divide-slate-800 dark:border-slate-800">
                    {housesLoading ? (
                      <div className="space-y-2 p-3">
                        {[0, 1, 2].map((row) => (
                          <div
                            key={row}
                            className="h-11 animate-pulse rounded-lg bg-gray-100 dark:bg-slate-800"
                          />
                        ))}
                      </div>
                    ) : houses.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                        {t("connectionsPage.whatsapp.no_houses")}
                      </p>
                    ) : (
                      houses.map((house) => (
                        <label
                          key={house.id}
                          className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-800/60"
                        >
                          <input
                            type="checkbox"
                            checked={assignHouseIds.includes(house.id)}
                            onChange={() => toggleAssignHouse(house.id)}
                            className="size-4 shrink-0 accent-green-600"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm text-gray-700 dark:text-gray-200">
                              {house.name}
                            </p>
                            <p className="font-mono text-[10px] text-gray-400">
                              {house.code}
                            </p>
                          </div>
                        </label>
                      ))
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {t("connectionsPage.houses_count", {
                        count: assignHouseIds.length,
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => void saveAssignedHouses()}
                      disabled={savingAssign || assignHouseIds.length === 0}
                      className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingAssign ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Link2 className="size-4" />
                      )}
                      {t("connectionsPage.actions.update")}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </ConnectionManagementDialog>

      <WhatsAppConnectionModal
        open={sharedConnectOpen}
        connectionId={qrConnectionId ?? sharedConnectionId}
        onClose={() => {
          setSharedConnectOpen(false);
          setQrConnectionId(null);
          onChanged();
        }}
        onConnected={handleSharedConnected}
        onContinue={handleSharedConnected}
      />

      <ConnectionManagementDialog
        open={housePickerOpen}
        onClose={() => {
          setHousePickerOpen(false);
          setHousePickerConnection(null);
          onChanged();
        }}
        title={t("connectionsPage.whatsapp.houses_title")}
        description={t("connectionsPage.whatsapp.houses_desc")}
      >
        <div className="space-y-4">
          {housePickerConnection?.phone_number && (
            <p className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
              {t("connectionsPage.status.connected")} ·{" "}
              {housePickerConnection.phone_number}
            </p>
          )}
          <div className="max-h-64 divide-y divide-gray-50 overflow-y-auto rounded-xl border border-gray-100 dark:divide-slate-800 dark:border-slate-800">
            {housesLoading ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((row) => (
                  <div
                    key={row}
                    className="h-11 animate-pulse rounded-lg bg-gray-100 dark:bg-slate-800"
                  />
                ))}
              </div>
            ) : houses.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                {t("connectionsPage.whatsapp.no_houses")}
              </p>
            ) : (
              houses.map((house) => (
                <label
                  key={house.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    checked={selectedHouseIds.includes(house.id)}
                    onChange={() => toggleHouseSelection(house.id)}
                    className="size-4 accent-green-600"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-700 dark:text-gray-200">
                      {house.name}
                    </p>
                    <p className="font-mono text-[10px] text-gray-400">
                      {house.code}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={() => void saveConnectionHouses()}
            disabled={savingHouses || selectedHouseIds.length === 0}
            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingHouses ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Link2 className="size-4" />
            )}
            {t("connectionsPage.actions.confirm")}
          </button>
        </div>
      </ConnectionManagementDialog>

      <ConfirmationModal
        isOpen={confirmOpen === "disconnect"}
        onClose={() => setConfirmOpen(null)}
        onConfirm={() => void disconnect()}
        title={t(
          sharedConnectionId
            ? "connectionsPage.whatsapp.shared_disconnect_title"
            : "connectionsPage.whatsapp.disconnect_title"
        )}
        message={t(
          sharedConnectionId
            ? "connectionsPage.whatsapp.shared_disconnect_desc"
            : "connectionsPage.whatsapp.disconnect_desc"
        )}
        confirmText={t("connectionsPage.actions.disconnect")}
        cancelText={t("connectionsPage.actions.cancel")}
        type="danger"
        loading={runningAction !== null}
      />

    </div>
  );
}
