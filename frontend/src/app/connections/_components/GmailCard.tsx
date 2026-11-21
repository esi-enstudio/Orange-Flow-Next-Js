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

const GMAIL_ERROR_KEYS: Record<string, string> = {
  gmail_oauth_not_configured: "connectionsPage.gmail.errors.oauth_not_configured",
  live_c2c_house_email_invalid: "connectionsPage.gmail.errors.house_email_invalid",
  gmail_house_email_missing: "connectionsPage.gmail.errors.house_email_missing",
  live_c2c_source_is_not_gmail: "connectionsPage.gmail.errors.source_conflict",
  gmail_authorization_denied: "connectionsPage.gmail.errors.authorization_denied",
  gmail_account_mismatch: "connectionsPage.gmail.errors.account_mismatch",
  gmail_refresh_token_missing: "connectionsPage.gmail.errors.refresh_token_missing",
  gmail_access_token_missing: "connectionsPage.gmail.errors.invalid_google_response",
  gmail_profile_invalid: "connectionsPage.gmail.errors.invalid_google_response",
  gmail_authorization_code_missing: "connectionsPage.gmail.errors.invalid_google_response",
  gmail_invalid_response: "connectionsPage.gmail.errors.invalid_google_response",
  gmail_request_failed: "connectionsPage.gmail.errors.google_request_failed",
  gmail_revoke_failed: "connectionsPage.gmail.errors.revoke_failed",
  gmail_history_expired: "connectionsPage.gmail.errors.history_expired",
  gmail_connection_not_ready: "connectionsPage.gmail.errors.reconnect_required",
};

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

  const gmailErrorText = (code: string) => {
    const key = GMAIL_ERROR_KEYS[code];
    return key
      ? t(key)
      : `${t("connectionsPage.gmail.connect_error")} (${code})`;
  };

  const gmailErrorFromResponse = (error: unknown) => {
    const data = (
      error as {
        response?: {
          data?: { error_code?: unknown; detail?: unknown };
        };
      }
    )?.response?.data;
    const detail = data?.detail;
    const detailCode =
      typeof detail === "object" && detail !== null && "code" in detail
        ? detail.code
        : undefined;
    const code = data?.error_code ?? detailCode;
    if (typeof code === "string") {
      return gmailErrorText(code);
    }
    return typeof detail === "string"
      ? detail
      : t("connectionsPage.action_failed");
  };

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
    } catch (error: unknown) {
      toast.error(gmailErrorFromResponse(error));
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
      toast.error(gmailErrorFromResponse(error));
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
        errorMessage={
          available && state?.error ? gmailErrorText(state.error) : undefined
        }
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
              {state?.account
                ? t("connectionsPage.gmail.connect_hint", { email: state.account })
                : t("connectionsPage.gmail.errors.house_email_missing")}
            </p>
            <button
              type="button"
              onClick={connect}
              disabled={busy !== null || !state?.account}
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
