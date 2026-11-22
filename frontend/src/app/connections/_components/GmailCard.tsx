"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Link2, Save, Unlink } from "lucide-react";
import apiClient, { API_BASE } from "@/lib/api";
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
  gmail_oauth_secret_invalid: "connectionsPage.gmail.errors.oauth_secret_invalid",
  gmail_oauth_client_secret_required:
    "connectionsPage.gmail.errors.client_secret_required",
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

interface GoogleOAuthSettings {
  client_id: string;
  client_secret_configured: boolean;
  redirect_uri: string;
}

function defaultGoogleOAuthRedirectUri() {
  if (typeof window === "undefined") return "";
  const apiBase = new URL(API_BASE, window.location.origin);
  const basePath = apiBase.pathname.replace(/\/api\/?$/, "").replace(/\/$/, "");
  return `${apiBase.origin}${basePath}/api/v1/live-c2c-automation/gmail/callback`;
}

export function GmailCard({ state, houseId, onChanged }: Props) {
  const { hasPermission } = useAuth();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [oauthSettingsLoaded, setOAuthSettingsLoaded] = useState(false);
  const [oauthSettingsLoading, setOAuthSettingsLoading] = useState(false);
  const [oauthSettingsLoadFailed, setOAuthSettingsLoadFailed] = useState(false);
  const [oauthSettingsSaving, setOAuthSettingsSaving] = useState(false);
  const [oauthClientId, setOAuthClientId] = useState("");
  const [oauthClientSecret, setOAuthClientSecret] = useState("");
  const [oauthClientSecretConfigured, setOAuthClientSecretConfigured] =
    useState(false);
  const [oauthRedirectUri, setOAuthRedirectUri] = useState("");
  const [oauthFieldErrors, setOAuthFieldErrors] = useState<
    Record<string, string>
  >({});

  const canAct = hasPermission("gmail.connect");
  const canConfigure = hasPermission("app_settings.manage");
  const connected = state?.connected === true;
  const available = state?.available !== false;
  const headers = { "X-House-ID": String(houseId) };

  useEffect(() => {
    if (
      !managementOpen ||
      available ||
      !canConfigure ||
      oauthSettingsLoaded
    ) {
      return;
    }

    let active = true;
    setOAuthSettingsLoading(true);
    setOAuthSettingsLoadFailed(false);
    apiClient
      .get("/v1/settings/google-oauth")
      .then(({ data }) => {
        if (!active) return;
        const settings = data as GoogleOAuthSettings;
        setOAuthClientId(settings.client_id ?? "");
        setOAuthClientSecretConfigured(
          settings.client_secret_configured === true
        );
        setOAuthRedirectUri(
          settings.redirect_uri || defaultGoogleOAuthRedirectUri()
        );
        setOAuthSettingsLoaded(true);
      })
      .catch(() => {
        if (active) setOAuthSettingsLoadFailed(true);
      })
      .finally(() => {
        if (active) setOAuthSettingsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [managementOpen, available, canConfigure, oauthSettingsLoaded]);

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

  const retryLoadOAuthSettings = () => {
    setOAuthSettingsLoadFailed(false);
    setOAuthSettingsLoaded(false);
  };

  const saveOAuthSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOAuthFieldErrors({});
    setOAuthSettingsSaving(true);
    try {
      const { data } = await apiClient.put("/v1/settings/google-oauth", {
        client_id: oauthClientId.trim(),
        client_secret: oauthClientSecret.trim() || null,
        redirect_uri: oauthRedirectUri.trim(),
      });
      setOAuthClientId(data.client_id ?? oauthClientId.trim());
      setOAuthClientSecret("");
      setOAuthClientSecretConfigured(data.client_secret_configured === true);
      setOAuthRedirectUri(data.redirect_uri ?? oauthRedirectUri.trim());
      toast.success(t("connectionsPage.gmail.setup_saved"));
      onChanged();
    } catch (error: unknown) {
      const response = (
        error as {
          response?: {
            data?: {
              _fieldErrors?: unknown;
              detail?: unknown;
              error_code?: unknown;
            };
          };
        }
      )?.response?.data;
      const rawFields =
        response?._fieldErrors ??
        (typeof response?.detail === "object" &&
        response.detail !== null &&
        "fields" in response.detail
          ? response.detail.fields
          : undefined);
      const fields: Record<string, string> = {};
      if (Array.isArray(rawFields)) {
        for (const field of rawFields) {
          if (
            typeof field === "object" &&
            field !== null &&
            "loc" in field &&
            Array.isArray(field.loc)
          ) {
            const name = field.loc[field.loc.length - 1];
            if (typeof name === "string") {
              fields[name] = t("connectionsPage.gmail.setup_validation_error");
            }
          }
        }
      } else if (typeof rawFields === "object" && rawFields !== null) {
        for (const name of ["client_id", "client_secret", "redirect_uri"]) {
          if (name in rawFields) {
            fields[name] = t("connectionsPage.gmail.setup_validation_error");
          }
        }
      }
      if (response?.error_code === "gmail_oauth_client_secret_required") {
        fields.client_secret = t(
          "connectionsPage.gmail.errors.client_secret_required"
        );
      }
      setOAuthFieldErrors(fields);
      toast.error(
        Object.keys(fields).length > 0
          ? t("connectionsPage.gmail.setup_save_failed")
          : gmailErrorFromResponse(error)
      );
    } finally {
      setOAuthSettingsSaving(false);
    }
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
          canAct || (!available && canConfigure) ? (
            <button
              type="button"
              onClick={() => setManagementOpen(true)}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-700"
            >
              <Link2 className="size-4" />
              {connected || available
                ? t("connectionsPage.actions.manage")
                : canConfigure
                  ? t("connectionsPage.gmail.setup_action")
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
            {canConfigure &&
              (oauthSettingsLoading ? (
                <div className="flex items-center gap-2 py-3 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  {t("connectionsPage.gmail.setup_loading")}
                </div>
              ) : oauthSettingsLoadFailed ? (
                <div className="space-y-2 pt-2">
                  <p role="alert" className="text-sm text-red-600">
                    {t("connectionsPage.gmail.setup_load_failed")}
                  </p>
                  <button
                    type="button"
                    onClick={retryLoadOAuthSettings}
                    className="min-h-11 cursor-pointer rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-700 dark:border-slate-700 dark:text-gray-200"
                  >
                    {t("connectionsPage.retry")}
                  </button>
                </div>
              ) : oauthSettingsLoaded ? (
                <form
                  onSubmit={saveOAuthSettings}
                  className="space-y-3 border-t border-gray-200 pt-4 dark:border-slate-700"
                >
                  <div className="space-y-1">
                    <label
                      htmlFor="gmail-oauth-client-id"
                      className="text-sm font-semibold text-gray-700 dark:text-gray-300"
                    >
                      {t("connectionsPage.gmail.client_id_label")}
                    </label>
                    <input
                      id="gmail-oauth-client-id"
                      type="text"
                      required
                      maxLength={512}
                      value={oauthClientId}
                      onChange={(event) => setOAuthClientId(event.target.value)}
                      className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
                    />
                    {oauthFieldErrors.client_id && (
                      <p className="text-sm text-red-600" role="alert">
                        {oauthFieldErrors.client_id}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="gmail-oauth-client-secret"
                      className="text-sm font-semibold text-gray-700 dark:text-gray-300"
                    >
                      {t("connectionsPage.gmail.client_secret_label")}
                    </label>
                    <input
                      id="gmail-oauth-client-secret"
                      type="password"
                      required={!oauthClientSecretConfigured}
                      maxLength={2048}
                      autoComplete="new-password"
                      value={oauthClientSecret}
                      onChange={(event) =>
                        setOAuthClientSecret(event.target.value)
                      }
                      placeholder={
                        oauthClientSecretConfigured
                          ? t("connectionsPage.gmail.client_secret_keep_hint")
                          : t("connectionsPage.gmail.client_secret_placeholder")
                      }
                      className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
                    />
                    {oauthFieldErrors.client_secret && (
                      <p className="text-sm text-red-600" role="alert">
                        {oauthFieldErrors.client_secret}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="gmail-oauth-redirect-uri"
                      className="text-sm font-semibold text-gray-700 dark:text-gray-300"
                    >
                      {t("connectionsPage.gmail.redirect_uri_label")}
                    </label>
                    <input
                      id="gmail-oauth-redirect-uri"
                      type="url"
                      required
                      maxLength={2048}
                      value={oauthRedirectUri}
                      onChange={(event) =>
                        setOAuthRedirectUri(event.target.value)
                      }
                      className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
                    />
                    {oauthFieldErrors.redirect_uri && (
                      <p className="text-sm text-red-600" role="alert">
                        {oauthFieldErrors.redirect_uri}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t("connectionsPage.gmail.setup_hint")}
                  </p>
                  <button
                    type="submit"
                    disabled={oauthSettingsSaving}
                    className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {oauthSettingsSaving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    {oauthSettingsSaving
                      ? t("connectionsPage.gmail.saving_setup")
                      : t("connectionsPage.gmail.save_setup")}
                  </button>
                </form>
              ) : null)}
          </div>
        ) : connected ? (
          canAct ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={busy !== null}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-300 bg-white px-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <Unlink className="size-4" />
              {t("connectionsPage.actions.disconnect")}
            </button>
          ) : null
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {state?.account
                ? t("connectionsPage.gmail.connect_hint", { email: state.account })
                : t("connectionsPage.gmail.errors.house_email_missing")}
            </p>
            {canAct && (
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
            )}
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
