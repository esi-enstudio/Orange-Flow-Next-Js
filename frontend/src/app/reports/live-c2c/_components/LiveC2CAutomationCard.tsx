"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, RefreshCw, Save } from "lucide-react";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";
import PageGuideModal from "@/components/PageGuideModal";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";

interface WhatsAppGroup {
  id: string;
  name: string;
}

interface AutomationConfig {
  source_type: "gmail" | "whatsapp" | null;
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
  import_status: string;
  delivery_status: string;
  last_error: string | null;
}

interface AutomationResponse {
  config: AutomationConfig;
  latest_file: LatestFile | null;
}

interface ApiErrorBody {
  error_code?: unknown;
}

interface Props {
  houseId: number;
  canView: boolean;
  canManage: boolean;
}

const AUTOMATION_ERROR_KEYS: Record<string, string> = {
  live_c2c_source_group_required: "source_group_required",
  live_c2c_source_group_invalid: "source_group_invalid",
  live_c2c_destination_group_required: "destination_group_required",
  live_c2c_destination_group_invalid: "destination_group_invalid",
  live_c2c_source_destination_same_group: "source_destination_same_group",
  live_c2c_whatsapp_mapping_exists: "mapping_exists",
  live_c2c_mapping_exists: "mapping_exists",
  live_c2c_whatsapp_webhook_reconfiguration_required: "webhook_reconfiguration_required",
  live_c2c_whatsapp_webhook_cleanup_failed: "webhook_cleanup_failed",
  live_c2c_whatsapp_device_not_configured: "device_not_configured",
  live_c2c_whatsapp_webhook_url_not_configured: "callback_not_configured",
  WA_NOT_CONFIGURED: "device_not_configured",
};

function getAutomationErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError<ApiErrorBody>(error)) return null;
  const code = error.response?.data?.error_code;
  return typeof code === "string" ? code : null;
}

export default function LiveC2CAutomationCard({
  houseId,
  canView,
  canManage,
}: Props) {
  const { t } = useLanguage();
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [latestFile, setLatestFile] = useState<LatestFile | null>(null);
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [sourceGroupJid, setSourceGroupJid] = useState("");
  const [destinationGroupJid, setDestinationGroupJid] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [statusRefreshError, setStatusRefreshError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const headers = useMemo(() => ({ "X-House-ID": String(houseId) }), [houseId]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    setConfig(null);
    setLatestFile(null);

    apiClient.get<AutomationResponse>("/v1/live-c2c-automation", {
      headers,
      signal: controller.signal,
    }).then(({ data }) => {
      setConfig(data.config);
      setLatestFile(data.latest_file);
      setSourceGroupJid(
        data.config.source_type === "whatsapp"
          ? data.config.source_group_jid ?? ""
          : "",
      );
      setDestinationGroupJid(data.config.destination_group_jid ?? "");
      setIsEnabled(data.config.is_enabled);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [canView, headers, retryKey]);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    setGroupsLoading(true);
    setGroupsError(false);
    setGroups([]);

    apiClient.get<{ data: WhatsAppGroup[] }>("/whatsapp/groups", {
      headers,
      signal: controller.signal,
    }).then(({ data }) => {
      setGroups(Array.isArray(data.data) ? data.data : []);
    }).catch(() => {
      if (!controller.signal.aborted) setGroupsError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setGroupsLoading(false);
    });

    return () => controller.abort();
  }, [canManage, headers, retryKey]);

  useEffect(() => {
    if (!canView || !config?.is_enabled) return;
    const refreshLatestFile = async () => {
      try {
        const { data } = await apiClient.get<AutomationResponse>(
          "/v1/live-c2c-automation",
          { headers },
        );
        setLatestFile(data.latest_file);
        setStatusRefreshError(false);
      } catch {
        setStatusRefreshError(true);
      }
    };
    const timer = window.setInterval(() => {
      void refreshLatestFile();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [canView, config?.is_enabled, headers]);

  const saveSettings = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const { data } = await apiClient.put<{ config: AutomationConfig }>(
        "/v1/live-c2c-automation",
        {
          source_type: "whatsapp",
          is_enabled: isEnabled,
          source_group_jid: sourceGroupJid || null,
          destination_group_jid: destinationGroupJid || null,
        },
        { headers },
      );
      setConfig(data.config);
      setSourceGroupJid(data.config.source_group_jid ?? "");
      setDestinationGroupJid(data.config.destination_group_jid ?? "");
      setIsEnabled(data.config.is_enabled);
      setSaved(true);
    } catch (error) {
      const code = getAutomationErrorCode(error);
      const errorKey = code
        ? AUTOMATION_ERROR_KEYS[code]
        : undefined;
      setSaveError(
        t(
          errorKey
            ? `live_c2c.automation.errors.${errorKey}`
            : "live_c2c.automation.errors.save_failed",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!canView) return null;

  const selectedSourceGroup =
    sourceGroupJid && !groups.some((group) => group.id === sourceGroupJid)
      ? config?.source_group_name
      : undefined;
  const selectedDestinationGroup =
    destinationGroupJid && !groups.some((group) => group.id === destinationGroupJid)
      ? config?.destination_group_name
      : undefined;
  const sourceRequired = isEnabled && !sourceGroupJid;
  const destinationRequired = isEnabled && !destinationGroupJid;
  const sameGroups =
    isEnabled && !!sourceGroupJid && sourceGroupJid === destinationGroupJid;
  const statusText = (type: "import" | "delivery", status: string) => {
    const path = `live_c2c.automation.statuses.${type}.${status}`;
    const translated = t(path);
    return translated === path ? status : translated;
  };

  return (
    <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("live_c2c.automation.title")}
            </h2>
            <PageGuideModal pageKey="live_c2c.automation" />
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t("live_c2c.automation.subtitle")}
          </p>
        </div>
        {config && (
          <span
            className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold ${
              config.is_enabled
                ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300"
                : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-300"
            }`}
          >
            {t(config.is_enabled ? "live_c2c.automation.enabled" : "live_c2c.automation.disabled")}
          </span>
        )}
      </header>

      {loading ? (
        <div className="mt-4 animate-pulse space-y-3" aria-hidden="true">
          <div className="h-11 w-full rounded-xl bg-gray-100 dark:bg-slate-800" />
          <div className="h-11 w-full rounded-xl bg-gray-100 dark:bg-slate-800" />
          <div className="h-10 w-40 rounded-xl bg-gray-100 dark:bg-slate-800" />
        </div>
      ) : loadError ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
          <p role="alert">{t("live_c2c.automation.errors.load_failed")}</p>
          <button
            type="button"
            onClick={() => setRetryKey((key) => key + 1)}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 font-semibold dark:border-red-500/40 dark:bg-slate-900"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {t("live_c2c.automation.retry")}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {canManage ? (
            <>
              {config?.source_type === "gmail" && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  {t("live_c2c.automation.whatsapp_source_replaces_gmail")}
                </p>
              )}
              {groupsError && (
                <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
                  <p role="alert">{t("live_c2c.automation.groups_error")}</p>
                  <button
                    type="button"
                    onClick={() => setRetryKey((key) => key + 1)}
                    className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 font-semibold dark:border-red-500/40 dark:bg-slate-900"
                  >
                    <RefreshCw aria-hidden="true" className="size-4" />
                    {t("live_c2c.automation.retry")}
                  </button>
                </div>
              )}
              {!groupsError && !groupsLoading && groups.length === 0 && (
                <p role="status" className="text-sm text-gray-500 dark:text-gray-400">
                  {t("live_c2c.automation.no_groups")}
                </p>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <EntitySelector
                  label={t("live_c2c.automation.source_group")}
                  items={[
                    ...(selectedSourceGroup
                      ? [{ id: sourceGroupJid, label: selectedSourceGroup }]
                      : []),
                    ...groups.map((group) => ({
                      id: group.id,
                      label: group.name,
                      sublabel: group.id,
                    })),
                  ]}
                  selectedIds={sourceGroupJid ? [sourceGroupJid] : []}
                  onChange={(ids) => {
                    setSourceGroupJid(typeof ids[0] === "string" ? ids[0] : "");
                    setSaveError(null);
                    setSaved(false);
                  }}
                  placeholder={t("live_c2c.automation.select_group")}
                  searchPlaceholder={t("live_c2c.automation.search_groups")}
                  emptyMessage={t("live_c2c.automation.no_groups")}
                  noResultsMessage={t("live_c2c.automation.no_matching_groups")}
                  disabled={!canManage || saving || groupsLoading || groupsError}
                  required
                  single
                  showSelectAll={false}
                  clearLabel={t("live_c2c.clear_selection")}
                />
                <EntitySelector
                  label={t("live_c2c.automation.destination_group")}
                  items={[
                    ...(selectedDestinationGroup
                      ? [{ id: destinationGroupJid, label: selectedDestinationGroup }]
                      : []),
                    ...groups.map((group) => ({
                      id: group.id,
                      label: group.name,
                      sublabel: group.id,
                    })),
                  ]}
                  selectedIds={destinationGroupJid ? [destinationGroupJid] : []}
                  onChange={(ids) => {
                    setDestinationGroupJid(typeof ids[0] === "string" ? ids[0] : "");
                    setSaveError(null);
                    setSaved(false);
                  }}
                  placeholder={t("live_c2c.automation.select_group")}
                  searchPlaceholder={t("live_c2c.automation.search_groups")}
                  emptyMessage={t("live_c2c.automation.no_groups")}
                  noResultsMessage={t("live_c2c.automation.no_matching_groups")}
                  disabled={!canManage || saving || groupsLoading || groupsError}
                  required
                  single
                  showSelectAll={false}
                  clearLabel={t("live_c2c.clear_selection")}
                />
              </div>
              {sourceRequired && (
                <p className="text-sm text-red-600 dark:text-red-300">
                  {t("live_c2c.automation.errors.source_group_required")}
                </p>
              )}
              {destinationRequired && (
                <p className="text-sm text-red-600 dark:text-red-300">
                  {t("live_c2c.automation.errors.destination_group_required")}
                </p>
              )}
              {sameGroups && (
                <p className="text-sm text-red-600 dark:text-red-300">
                  {t("live_c2c.automation.errors.source_destination_same_group")}
                </p>
              )}
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(event) => {
                    setIsEnabled(event.target.checked);
                    setSaveError(null);
                    setSaved(false);
                  }}
                  disabled={saving}
                  className="size-4 cursor-pointer accent-primary-600 disabled:cursor-not-allowed"
                />
                {t("live_c2c.automation.enable")}
              </label>
              {saveError && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                >
                  {saveError}
                </p>
              )}
              {saved && (
                <p
                  role="status"
                  className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300"
                >
                  {t("live_c2c.automation.saved")}
                </p>
              )}
              <button
                type="button"
                onClick={saveSettings}
                disabled={
                  saving
                  || (isEnabled && (
                    groupsLoading
                    || groupsError
                    || sourceRequired
                    || destinationRequired
                    || sameGroups
                  ))
                }
                className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {saving ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Save aria-hidden="true" className="size-4" />
                )}
                {t(saving ? "live_c2c.automation.saving" : "live_c2c.automation.save")}
              </button>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-gray-500 dark:text-gray-400">
                  {t("live_c2c.automation.source_group")}
                </p>
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {config?.source_group_name ?? config?.gmail_address ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">
                  {t("live_c2c.automation.destination_group")}
                </p>
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {config?.destination_group_name ?? "—"}
                </p>
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("live_c2c.automation.latest_file")}
            </h3>
            {latestFile ? (
              <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <p className="min-w-0 truncate font-medium text-gray-800 dark:text-gray-200" title={latestFile.filename}>
                  {latestFile.filename}
                </p>
                <p className="text-gray-600 dark:text-gray-300">
                  {t("live_c2c.automation.import_status")}:{" "}
                  {statusText("import", latestFile.import_status)}
                </p>
                <p className="text-gray-600 dark:text-gray-300">
                  {t("live_c2c.automation.delivery_status")}:{" "}
                  {statusText("delivery", latestFile.delivery_status)}
                </p>
                {latestFile.last_error && (
                  <p role="status" className="text-amber-700 dark:text-amber-300 sm:col-span-3">
                    {t("live_c2c.automation.file_error")}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {t("live_c2c.automation.no_files")}
              </p>
            )}
            {statusRefreshError && (
              <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                {t("live_c2c.automation.status_refresh_error")}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
