"use client";

import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Mail, MessageCircle, Save, TriangleAlert } from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import EntitySelector, { type SelectorItem } from "@/app/zoom-in/_components/EntitySelector";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";

type SourceType = "gmail" | "whatsapp";

interface AutomationConfig {
  source_type: SourceType | null;
  is_enabled: boolean;
  gmail_address: string | null;
  gmail_status: string;
  gmail_error: string | null;
  source_group_jid: string | null;
  source_group_name: string | null;
  destination_group_jid: string | null;
  destination_group_name: string | null;
}

interface LatestFile {
  filename: string;
  received_at: string;
  import_status: string;
  delivery_status: string;
  last_error: string | null;
}

interface AutomationResponse {
  config: AutomationConfig;
  latest_file: LatestFile | null;
}

interface WhatsAppGroup {
  id: string;
  name: string;
}

interface ApiErrorBody {
  error_code?: unknown;
  detail?: string | { code?: unknown };
}

type FieldErrors = {
  sourceGroup?: string;
  destinationGroup?: string;
};

const API_ERROR_KEYS: Record<string, string> = {
  live_c2c_source_required: "errors.source_required",
  live_c2c_destination_group_required: "errors.destination_group_required",
  live_c2c_destination_group_invalid: "errors.destination_group_invalid",
  live_c2c_source_group_required: "errors.source_group_required",
  live_c2c_source_group_invalid: "errors.source_group_invalid",
  live_c2c_gmail_mapping_exists: "errors.mapping_exists",
  live_c2c_whatsapp_mapping_exists: "errors.mapping_exists",
  live_c2c_whatsapp_webhook_reconfiguration_required: "errors.webhook_reconfiguration_required",
  live_c2c_whatsapp_device_not_configured: "errors.device_not_configured",
  live_c2c_whatsapp_webhook_url_not_configured: "errors.callback_not_configured",
};

function getApiErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError<ApiErrorBody>(error)) return null;
  const errorCode = error.response?.data?.error_code;
  if (typeof errorCode === "string") return errorCode;
  const detail = error.response?.data?.detail;
  if (typeof detail !== "object" || detail === null) return null;
  return typeof detail.code === "string" ? detail.code : null;
}

function formatReceivedAt(value: string): string {
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? value
    : `${value.replace(" ", "T")}+06:00`;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dhaka",
  }).format(date);
}

export default function LiveC2CAutomationSettings({
  houseId,
  canManage,
  canView,
}: {
  houseId: number | null;
  canManage: boolean;
  canView: boolean;
}) {
  const { t } = useLanguage();
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [latestFile, setLatestFile] = useState<LatestFile | null>(null);
  const [sourceType, setSourceType] = useState<SourceType | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [sourceGroupJid, setSourceGroupJid] = useState<string | null>(null);
  const [destinationGroupJid, setDestinationGroupJid] = useState<string | null>(null);
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState(false);
  const [configRetry, setConfigRetry] = useState(0);
  const [groupsRetry, setGroupsRetry] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [statusRefreshError, setStatusRefreshError] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<"connected" | "error" | null>(null);

  const houseHeaders = useMemo(
    () => (houseId ? { "X-House-ID": String(houseId) } : {}),
    [houseId],
  );

  const applyConfig = useCallback((data: AutomationResponse, updateForm: boolean) => {
    setConfig(data.config);
    setLatestFile(data.latest_file);
    if (!updateForm) return;
    setSourceType(data.config.source_type);
    setIsEnabled(data.config.is_enabled);
    setSourceGroupJid(data.config.source_group_jid);
    setDestinationGroupJid(data.config.destination_group_jid);
  }, []);

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    if (!houseId) return;
    const { data } = await apiClient.get<AutomationResponse>("/v1/live-c2c-automation", {
      headers: houseHeaders,
      signal,
    });
    applyConfig(data, false);
  }, [applyConfig, houseHeaders, houseId]);

  useEffect(() => {
    if (!houseId || !canView) {
      setLoading(false);
      setConfig(null);
      setLatestFile(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    setStatusRefreshError(false);
    apiClient.get<AutomationResponse>("/v1/live-c2c-automation", {
      headers: houseHeaders,
      signal: controller.signal,
    }).then(({ data }) => {
      applyConfig(data, true);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [applyConfig, canView, configRetry, houseHeaders, houseId]);

  useEffect(() => {
    if (!houseId || !canManage) {
      setGroups([]);
      setGroupsLoading(false);
      return;
    }

    const controller = new AbortController();
    setGroupsLoading(true);
    setGroupsError(false);
    apiClient.get<{ data?: WhatsAppGroup[] }>("/whatsapp/groups", {
      headers: houseHeaders,
      signal: controller.signal,
    }).then(({ data }) => {
      setGroups(Array.isArray(data?.data) ? data.data : []);
    }).catch(() => {
      if (!controller.signal.aborted) setGroupsError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setGroupsLoading(false);
    });

    return () => controller.abort();
  }, [canManage, groupsRetry, houseHeaders, houseId]);

  useEffect(() => {
    if (!houseId || !canView) return;
    const timer = window.setInterval(() => {
      refreshStatus()
        .then(() => setStatusRefreshError(false))
        .catch(() => setStatusRefreshError(true));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [canView, houseId, refreshStatus]);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("automation");
    if (status === "gmail_connected") setOauthStatus("connected");
    if (status === "gmail_error") setOauthStatus("error");
  }, []);

  const savedGroupItems = useCallback((
    jid: string | null,
    name: string | null,
  ): SelectorItem[] => {
    const items: SelectorItem[] = groups.map((group) => ({
      id: group.id,
      label: group.name,
    }));
    if (jid && !items.some((item) => item.id === jid)) {
      items.unshift({ id: jid, label: name || jid });
    }
    return items;
  }, [groups]);

  const sourceGroupItems = savedGroupItems(sourceGroupJid ?? config?.source_group_jid ?? null, config?.source_group_name ?? null);
  const destinationGroupItems = savedGroupItems(
    destinationGroupJid ?? config?.destination_group_jid ?? null,
    config?.destination_group_name ?? null,
  );

  const saveConfig = async () => {
    if (!houseId) return;
    const errors: FieldErrors = {};
    if (isEnabled && !sourceType) {
      setErrorKey("errors.source_required");
      setFieldErrors(errors);
      return;
    }
    if (isEnabled && sourceType === "gmail" && config?.gmail_status !== "connected") {
      setErrorKey("errors.gmail_required");
      setFieldErrors(errors);
      return;
    }
    if (isEnabled && !destinationGroupJid) {
      errors.destinationGroup = "errors.destination_group_required";
    }
    if (isEnabled && sourceType === "whatsapp" && !sourceGroupJid) {
      errors.sourceGroup = "errors.source_group_required";
    }
    setFieldErrors(errors);
    setErrorKey(null);
    setSaved(false);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const { data } = await apiClient.put<{ config: AutomationConfig }>(
        "/v1/live-c2c-automation",
        {
          source_type: sourceType,
          is_enabled: isEnabled,
          source_group_jid: sourceType === "whatsapp" ? sourceGroupJid : null,
          destination_group_jid: destinationGroupJid,
        },
        { headers: houseHeaders },
      );
      setConfig(data.config);
      setSourceType(data.config.source_type);
      setIsEnabled(data.config.is_enabled);
      setSourceGroupJid(data.config.source_group_jid);
      setDestinationGroupJid(data.config.destination_group_jid);
      setSaved(true);
    } catch (error) {
      const code = getApiErrorCode(error);
      setErrorKey(API_ERROR_KEYS[code ?? ""] ?? "errors.save_failed");
      if (code === "live_c2c_destination_group_invalid") {
        setFieldErrors({ destinationGroup: "errors.destination_group_invalid" });
      } else if (code === "live_c2c_source_group_invalid") {
        setFieldErrors({ sourceGroup: "errors.source_group_invalid" });
      }
    } finally {
      setSaving(false);
    }
  };

  const connectGmail = async () => {
    if (!houseId) return;
    setConnecting(true);
    setErrorKey(null);
    try {
      const { data } = await apiClient.post<{ authorization_url: string }>(
        "/v1/live-c2c-automation/gmail/authorize",
        {},
        { headers: houseHeaders },
      );
      window.location.assign(data.authorization_url);
    } catch {
      setErrorKey("errors.gmail_connect_failed");
      setConnecting(false);
    }
  };

  const disconnectGmail = async () => {
    if (!houseId) return;
    setDisconnecting(true);
    setErrorKey(null);
    try {
      await apiClient.post("/v1/live-c2c-automation/gmail/disconnect", {}, { headers: houseHeaders });
      await refreshStatus();
    } catch {
      setErrorKey("errors.gmail_disconnect_failed");
    } finally {
      setDisconnecting(false);
    }
  };

  if (!houseId || (!canView && !canManage)) return null;

  const sourceItems: SelectorItem[] = [
    { id: "gmail", label: t("live_c2c.automation.gmail") },
    { id: "whatsapp", label: t("live_c2c.automation.whatsapp") },
  ];

  return (
    <section
      aria-labelledby="live-c2c-automation-title"
      className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-5"
    >
      <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-4 dark:border-slate-800">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400">
            <Mail aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="live-c2c-automation-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t("live_c2c.automation.title")}
              </h2>
              <PageGuideModal pageKey="live_c2c.automation" />
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("live_c2c.automation.subtitle")}
            </p>
          </div>
        </div>
        {config && (
          <span className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold ${
            config.is_enabled
              ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300"
              : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-300"
          }`}>
            {t(config.is_enabled ? "live_c2c.automation.enabled" : "live_c2c.automation.disabled")}
          </span>
        )}
      </div>

      {loading ? (
        <div role="status" aria-label={t("live_c2c.automation.loading")} className="space-y-4 animate-pulse">
          <div className="h-11 w-full rounded-xl bg-gray-100 dark:bg-slate-800" />
          <div className="h-11 w-full rounded-xl bg-gray-100 dark:bg-slate-800" />
          <div className="h-20 w-full rounded-xl bg-gray-100 dark:bg-slate-800" />
        </div>
      ) : loadError || !config ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
          <span>{t("live_c2c.automation.errors.load_failed")}</span>
          <button
            type="button"
            onClick={() => setConfigRetry((value) => value + 1)}
            className="min-h-11 w-full rounded-xl border border-red-300 px-3 font-semibold cursor-pointer sm:w-auto dark:border-red-400/40"
          >
            {t("live_c2c.automation.retry")}
          </button>
        </div>
      ) : (
        <>
          {canManage && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <EntitySelector
                  label={t("live_c2c.automation.source")}
                  items={sourceItems}
                  selectedIds={sourceType ? [sourceType] : []}
                  onChange={(ids) => {
                    const value = ids[0];
                    setSourceType(value === "gmail" || value === "whatsapp" ? value : null);
                    setFieldErrors({});
                    setErrorKey(null);
                  }}
                  placeholder={t("live_c2c.automation.select_source")}
                  searchPlaceholder={t("live_c2c.automation.search_sources")}
                  emptyMessage={t("live_c2c.automation.no_sources")}
                  noResultsMessage={t("live_c2c.automation.no_matching_sources")}
                  single
                  showSelectAll={false}
                  clearLabel={t("live_c2c.clear_selection")}
                  disabled={saving}
                  required={isEnabled}
                />

                {sourceType === "whatsapp" ? (
                  <EntitySelector
                    label={t("live_c2c.automation.source_group")}
                    items={sourceGroupItems}
                    selectedIds={sourceGroupJid ? [sourceGroupJid] : []}
                    onChange={(ids) => {
                      setSourceGroupJid(typeof ids[0] === "string" ? ids[0] : null);
                      setFieldErrors((previous) => ({ ...previous, sourceGroup: undefined }));
                      setErrorKey(null);
                    }}
                    placeholder={t("live_c2c.automation.select_group")}
                    searchPlaceholder={t("live_c2c.automation.search_groups")}
                    emptyMessage={t("live_c2c.automation.no_groups")}
                    noResultsMessage={t("live_c2c.automation.no_matching_groups")}
                    error={fieldErrors.sourceGroup ? t(`live_c2c.automation.${fieldErrors.sourceGroup}`) : undefined}
                    single
                    showSelectAll={false}
                    clearLabel={t("live_c2c.clear_selection")}
                    disabled={saving || groupsLoading}
                    required={isEnabled}
                  />
                ) : (
                  <div className="min-w-0">
                    <p className="mb-1.5 block text-sm font-bold text-gray-700 dark:text-gray-300">
                      {t("live_c2c.automation.mailbox")}
                    </p>
                    <div className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 dark:border-slate-800 dark:bg-slate-800 dark:text-gray-200">
                      <Mail aria-hidden="true" className="size-4 shrink-0 text-gray-400" />
                      <span className="truncate">{config.gmail_address || "—"}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {t("live_c2c.automation.mailbox_hint")}
                    </p>
                  </div>
                )}

                <EntitySelector
                  label={t("live_c2c.automation.destination_group")}
                  items={destinationGroupItems}
                  selectedIds={destinationGroupJid ? [destinationGroupJid] : []}
                  onChange={(ids) => {
                    setDestinationGroupJid(typeof ids[0] === "string" ? ids[0] : null);
                    setFieldErrors((previous) => ({ ...previous, destinationGroup: undefined }));
                    setErrorKey(null);
                  }}
                  placeholder={t("live_c2c.automation.select_group")}
                  searchPlaceholder={t("live_c2c.automation.search_groups")}
                  emptyMessage={t("live_c2c.automation.no_groups")}
                  noResultsMessage={t("live_c2c.automation.no_matching_groups")}
                  error={fieldErrors.destinationGroup ? t(`live_c2c.automation.${fieldErrors.destinationGroup}`) : undefined}
                  single
                  showSelectAll={false}
                  clearLabel={t("live_c2c.clear_selection")}
                  disabled={saving || groupsLoading}
                  required={isEnabled}
                />
              </div>

              {groupsError && (
                <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                  <span>{t("live_c2c.automation.groups_error")}</span>
                  <button
                    type="button"
                    onClick={() => setGroupsRetry((value) => value + 1)}
                    className="min-h-11 w-full rounded-xl border border-amber-300 px-3 font-semibold cursor-pointer sm:w-auto dark:border-amber-400/40"
                  >
                    {t("live_c2c.automation.retry")}
                  </button>
                </div>
              )}

              {sourceType === "gmail" && (
                <>
                  <div className="flex flex-col gap-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      {config.gmail_status === "connected" ? (
                        <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-green-600 dark:text-green-400" />
                      ) : (
                        <Mail aria-hidden="true" className="size-4 shrink-0 text-gray-400" />
                      )}
                      <span className="text-gray-700 dark:text-gray-200">
                        {t(`live_c2c.automation.gmail_status.${
                          config.gmail_status === "connected"
                            ? "connected"
                            : config.gmail_status === "error"
                              ? "error"
                              : "disconnected"
                        }`)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {config.gmail_status === "connected" ? (
                        <button
                          type="button"
                          onClick={disconnectGmail}
                          disabled={disconnecting || saving}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800 sm:w-auto"
                        >
                          {t(disconnecting ? "live_c2c.automation.disconnecting" : "live_c2c.automation.disconnect_gmail")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={connectGmail}
                          disabled={connecting || saving}
                          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer sm:w-auto"
                        >
                          {t(connecting ? "live_c2c.automation.connecting" : "live_c2c.automation.connect_gmail")}
                        </button>
                      )}
                    </div>
                  </div>
                  {config.gmail_status === "error" && (
                    <p role="alert" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      {t("live_c2c.automation.gmail_status.error_hint")}
                    </p>
                  )}
                </>
              )}

              <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(event) => setIsEnabled(event.target.checked)}
                    disabled={saving}
                    className="size-4 cursor-pointer accent-primary-600 disabled:cursor-not-allowed"
                  />
                  {t("live_c2c.automation.enable")}
                </label>
                <button
                  type="button"
                  onClick={saveConfig}
                  disabled={saving || groupsLoading}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer sm:w-auto"
                >
                  <Save aria-hidden="true" className="size-4" />
                  {t(saving ? "live_c2c.automation.saving" : "live_c2c.automation.save")}
                </button>
              </div>
            </div>
          )}

          {errorKey && (
            <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {t(`live_c2c.automation.${errorKey}`)}
            </p>
          )}
          {saved && (
            <p role="status" className="mt-4 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-200">
              {t("live_c2c.automation.saved")}
            </p>
          )}
          {oauthStatus && (
            <p
              role="status"
              className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                oauthStatus === "connected"
                  ? "border-green-200 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-200"
                  : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
              }`}
            >
              {oauthStatus === "connected"
                ? <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
                : <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />}
              {t(`live_c2c.automation.oauth.${oauthStatus}`)}
            </p>
          )}

          {canView && (
            <div className="mt-4 rounded-xl bg-gray-50 p-3 dark:bg-slate-800/60">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                <Clock3 aria-hidden="true" className="size-4 text-gray-500" />
                {t("live_c2c.automation.latest_file")}
              </div>
              {latestFile ? (
                <div className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
                  <p className="min-w-0 break-all text-gray-700 dark:text-gray-200">{latestFile.filename}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatReceivedAt(latestFile.received_at)}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    {t("live_c2c.automation.import_status")}:{" "}
                    {t(`live_c2c.automation.statuses.import.${latestFile.import_status}`)}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    {t("live_c2c.automation.delivery_status")}:{" "}
                    {t(`live_c2c.automation.statuses.delivery.${latestFile.delivery_status}`)}
                  </p>
                  {latestFile.last_error && (
                    <p role="alert" className="sm:col-span-2 flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
                      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      {t("live_c2c.automation.file_error")}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  <MessageCircle aria-hidden="true" className="mr-1 inline size-4" />
                  {t("live_c2c.automation.no_files")}
                </p>
              )}
            </div>
          )}
          {statusRefreshError && (
            <p role="alert" className="mt-3 text-xs text-amber-700 dark:text-amber-300">
              {t("live_c2c.automation.status_refresh_error")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
