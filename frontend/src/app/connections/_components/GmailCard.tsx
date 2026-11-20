"use client";

import { useState } from "react";
import { Loader2, Link2, Unlink } from "lucide-react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import type { HouseConnectionState } from "@/hooks/useHouseConnections";
import { CONNECTION_PROVIDERS } from "@/lib/connectionProviders";
import { ProviderCard } from "./ProviderCard";
import { ConnectionManagementDialog } from "./ConnectionManagementDialog";

interface Props {
  state?: HouseConnectionState;
  houseId: number;
  onChanged: () => void;
}

export function GmailCard({ state, houseId, onChanged }: Props) {
  const { hasPermission } = useAuth();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);

  const canAct = hasPermission("gmail.connect");
  const connected = state?.connected === true;
  const available = state?.available !== false;
  const headers = { "X-House-ID": String(houseId) };

  const closeManagement = () => {
    setManagementOpen(false);
    setConfirmOpen(false);
  };

  const connect = async () => {
    setBusy("connect");
    try {
      const res = await apiClient.post(
        "/v1/live-c2c-automation/gmail/authorize",
        null,
        { headers, params: { return_path: "/connections" } }
      );
      const url = res.data?.authorization_url;
      if (typeof url !== "string" || !url) throw new Error("missing authorization url");
      window.location.href = url;
    } catch {
      toast.error(t("connectionsPage.action_failed"));
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await apiClient.post("/v1/live-c2c-automation/gmail/disconnect", null, {
        headers,
      });
      toast.success(t("connectionsPage.actions.disconnect"));
      setConfirmOpen(false);
      onChanged();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("connectionsPage.action_failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-w-0">
      <ProviderCard
        presentation={CONNECTION_PROVIDERS.gmail}
        state={state}
        action={
          canAct ? (
            <button
              type="button"
              onClick={() => setManagementOpen(true)}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-700"
            >
              <Link2 className="size-4" />
              {connected
                ? t("connectionsPage.actions.manage")
                : t("connectionsPage.actions.connect")}
            </button>
          ) : null
        }
      />

      <ConnectionManagementDialog
        open={managementOpen}
        onClose={closeManagement}
        title={t("connectionsPage.gmail.name")}
        description={t("connectionsPage.gmail.description")}
        errorMessage={state?.error}
      >
        {!available ? (
          <div className="space-y-1 text-sm text-gray-500 dark:text-gray-400">
            <p className="font-semibold text-gray-700 dark:text-gray-300">
              {t("connectionsPage.gmail.unavailable")}
            </p>
            <p>{t("connectionsPage.gmail.unavailable_hint")}</p>
          </div>
        ) : connected ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy !== null}
            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-300 bg-white px-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <Unlink className="size-4" />
            {t("connectionsPage.actions.disconnect")}
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("connectionsPage.gmail.connect_hint")}
            </p>
            <button
              type="button"
              onClick={connect}
              disabled={busy !== null}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "connect" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              {busy === "connect"
                ? t("connectionsPage.actions.connecting")
                : t("connectionsPage.actions.connect")}
            </button>
          </div>
        )}
      </ConnectionManagementDialog>

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={disconnect}
        title={t("connectionsPage.gmail.disconnect_title")}
        message={t("connectionsPage.gmail.disconnect_desc")}
        confirmText={t("connectionsPage.actions.disconnect")}
        cancelText={t("connectionsPage.actions.cancel")}
        type="danger"
        loading={busy === "disconnect"}
      />
    </div>
  );
}
