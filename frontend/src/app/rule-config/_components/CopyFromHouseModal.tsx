"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  Users,
  X,
} from "lucide-react";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";

interface CopyFromHouseModalProps {
  open: boolean;
  onClose: () => void;
  onCopied: () => void;
  houses: { id: number; name: string; code: string; display_name: string }[];
  targetHouseId: number | null;
  headers?: Record<string, string>;
}

/**
 * Prefer the server's own error text so a misconfiguration (missing
 * X-House-ID, missing permission, same source/target) is visible instead of a
 * generic "please try again".
 */
function extractError(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown; error?: { message?: string } } } })
    ?.response?.data;
  if (typeof detail?.detail === "string" && detail.detail.trim()) return detail.detail;
  if (typeof detail?.error?.message === "string" && detail.error.message.trim()) {
    return detail.error.message;
  }
  return fallback;
}

type CopyAction = "create" | "overwrite" | "skip";

interface PlanRow {
  source_rule_id: number;
  context_key: string;
  rule_name: string;
  target_role: string;
  apply_to: string;
  column_key: string;
  is_active: boolean;
  action: CopyAction;
  existing_rule_name: string | null;
  source_employee_count: number;
  kept_employee_count: number;
  dropped_employee_count: number;
}

interface CopyPlan {
  source_house: { id: number; name: string; code: string };
  target_house: { id: number; name: string; code: string };
  copy_contexts: boolean;
  context_note: string;
  source_rule_count: number;
  to_create: number;
  to_skip: number;
  to_overwrite: number;
  rules_with_employee_selection: number;
  total_employee_selections: number;
  valid_target_employee_count: number;
  rows: PlanRow[];
}

interface CopyResult {
  source_house: { id: number; name: string; code: string };
  target_house: { id: number; name: string; code: string };
  created: number;
  overwritten: number;
  skipped: number;
}

const ROLE_BADGE: Record<string, string> = {
  HOUSE: "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300",
  SUPERVISOR: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300",
  RSO: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  BP: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const ACTION_BADGE: Record<CopyAction, string> = {
  create: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  overwrite: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
  skip: "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400",
};

export default function CopyFromHouseModal({
  open,
  onClose,
  onCopied,
  houses,
  targetHouseId,
  headers = {},
}: CopyFromHouseModalProps) {
  const { t } = useLanguage();
  const tC = useCallback(
    (path: string, params?: Record<string, string | number | undefined>) =>
      t(`rule_config.copy.${path}`, params),
    [t]
  );

  const [mounted] = useState(() => typeof document !== "undefined");
  const [sourceHouseId, setSourceHouseId] = useState<string>("");
  const [includeEmployeeIds, setIncludeEmployeeIds] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [plan, setPlan] = useState<CopyPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CopyResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setSourceHouseId("");
    setIncludeEmployeeIds(false);
    setIncludeInactive(true);
    setPlan(null);
    setError(null);
    setResult(null);
    setConfirmOpen(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const targetHouse = useMemo(
    () => houses.find((h) => h.id === targetHouseId) ?? null,
    [houses, targetHouseId]
  );

  const sourceHouses = useMemo(
    () => houses.filter((h) => h.id !== targetHouseId),
    [houses, targetHouseId]
  );

  const loadPlan = useCallback(async () => {
    if (!sourceHouseId) {
      setError(tC("messages.pick_source"));
      return;
    }
    if (!targetHouseId) {
      setError(tC("messages.pick_target"));
      return;
    }
    setLoadingPlan(true);
    setError(null);
    setPlan(null);
    try {
      const params = new URLSearchParams({
        source_house_id: sourceHouseId,
        target_house_id: String(targetHouseId),
        include_employee_ids: String(includeEmployeeIds),
        include_inactive: String(includeInactive),
      });
      const res = await apiClient.get<{ data: CopyPlan }>(
        `/rule-config/copy-from-house/preview?${params.toString()}`,
        { headers }
      );
      setPlan(res.data.data ?? null);
    } catch (err) {
      setError(extractError(err, tC("messages.preview_failed")));
    } finally {
      setLoadingPlan(false);
    }
  }, [sourceHouseId, targetHouseId, includeEmployeeIds, includeInactive, headers, tC]);

  const runCopy = useCallback(async () => {
    if (!sourceHouseId || !targetHouseId) {
      setConfirmOpen(false);
      setError(tC("messages.pick_target"));
      return;
    }
    setCopying(true);
    setError(null);
    try {
      const res = await apiClient.post<{ data: CopyResult }>(
        "/rule-config/copy-from-house",
        {
          source_house_id: Number(sourceHouseId),
          include_employee_ids: includeEmployeeIds,
          include_inactive: includeInactive,
          mode: "skip",
        },
        { headers }
      );
      setResult(res.data.data ?? null);
      setPlan(null);
      setConfirmOpen(false);
    } catch (err) {
      setError(extractError(err, tC("messages.copy_failed")));
      setConfirmOpen(false);
    } finally {
      setCopying(false);
    }
  }, [sourceHouseId, targetHouseId, includeEmployeeIds, includeInactive, headers, tC]);

  if (!open || !mounted) return null;

  const hasRules = (plan?.source_rule_count ?? 0) > 0;
  const copiesNothing = hasRules && (plan?.to_create ?? 0) === 0 && (plan?.to_overwrite ?? 0) === 0;

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={onClose}
              className="fixed inset-0 z-[210] flex items-start md:items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm"
            >
              <motion.div
                onClick={(e) => e.stopPropagation()}
                initial={{ scale: 0.96, opacity: 0, y: 12 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 12 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="w-full md:max-w-2xl my-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 flex flex-col overflow-hidden max-h-[92vh]"
              >
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/15 flex items-center justify-center shrink-0">
                  <Copy className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {tC("title")}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{tC("subtitle")}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-11 h-11 rounded-xl flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all cursor-pointer shrink-0"
                aria-label={t("common.close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {error && (
                <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">{error}</div>
                  <button
                    onClick={() => setError(null)}
                    className="shrink-0 text-red-400 hover:text-red-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {result ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div className="text-sm text-emerald-700 dark:text-emerald-300">
                      <p className="font-semibold">{tC("result.title")}</p>
                      <p className="mt-1">
                        {tC("result.summary", {
                          source: result.source_house.name,
                          created: result.created,
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: tC("result.created"), value: result.created, tone: "text-emerald-600 dark:text-emerald-400" },
                      { label: tC("result.skipped"), value: result.skipped, tone: "text-gray-500 dark:text-gray-400" },
                      { label: tC("result.overwritten"), value: result.overwritten, tone: "text-amber-600 dark:text-amber-400" },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="rounded-xl border border-gray-200 dark:border-slate-800 px-3 py-3 text-center"
                      >
                        <p className={cn("text-xl font-bold", s.tone)}>{s.value}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                          {s.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {/* House selection */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex-1 min-w-[140px]">
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                          {tC("fields.source_house")}
                        </label>
                        <select
                          value={sourceHouseId}
                          onChange={(e) => {
                            setSourceHouseId(e.target.value);
                            setPlan(null);
                            setError(null);
                          }}
                          className="w-full rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 cursor-pointer"
                        >
                          <option value="">{tC("fields.select_source")}</option>
                          {sourceHouses.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.display_name || h.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <ArrowRight className="w-5 h-5 text-gray-300 dark:text-slate-600 mt-6 hidden sm:block shrink-0" />
                      <div className="flex-1 min-w-[140px]">
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                          {tC("fields.target_house")}
                        </label>
                        <div className="w-full rounded-xl bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-800 px-3.5 py-2.5 text-sm text-gray-600 dark:text-gray-400">
                          {targetHouse
                            ? targetHouse.display_name || targetHouse.name
                            : tC("fields.no_target")}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-xs text-blue-700 dark:text-blue-300">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <p>{tC("context_note")}</p>
                    </div>

                    <button
                      onClick={loadPlan}
                      disabled={!sourceHouseId || !targetHouseId || loadingPlan}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-400 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {loadingPlan ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                      {tC("buttons.preview")}
                    </button>
                  </div>

                  {/* Options */}
                  <div className="space-y-2.5">
                    <label className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={includeEmployeeIds}
                        onChange={(e) => {
                          setIncludeEmployeeIds(e.target.checked);
                          setPlan(null);
                        }}
                        className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                          {tC("fields.include_employee_ids")}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {tC("fields.include_employee_ids_hint")}
                        </p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={includeInactive}
                        onChange={(e) => {
                          setIncludeInactive(e.target.checked);
                          setPlan(null);
                        }}
                        className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                          {tC("fields.include_inactive")}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {tC("fields.include_inactive_hint")}
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Plan preview */}
                  {loadingPlan && (
                    <div className="space-y-2.5" aria-busy="true">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-14 rounded-xl bg-gray-100 dark:bg-slate-800 animate-pulse"
                        />
                      ))}
                    </div>
                  )}

                  {!loadingPlan && plan && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: tC("summary.create"), value: plan.to_create, tone: "text-emerald-600 dark:text-emerald-400" },
                          { label: tC("summary.overwrite"), value: plan.to_overwrite, tone: "text-amber-600 dark:text-amber-400" },
                          { label: tC("summary.skip"), value: plan.to_skip, tone: "text-gray-500 dark:text-gray-400" },
                        ].map((s) => (
                          <div
                            key={s.label}
                            className="rounded-xl border border-gray-200 dark:border-slate-800 px-3 py-3 text-center"
                          >
                            <p className={cn("text-xl font-bold", s.tone)}>{s.value}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                              {s.label}
                            </p>
                          </div>
                        ))}
                      </div>

                      {plan.rules_with_employee_selection > 0 && (
                        <div
                          className={cn(
                            "flex items-start gap-2 px-3.5 py-2.5 rounded-xl border text-xs",
                            includeEmployeeIds
                              ? plan.total_employee_selections > 0
                                ? "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300"
                                : "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                              : "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300"
                          )}
                        >
                          <Users className="w-4 h-4 shrink-0 mt-0.5" />
                          <p>
                            {includeEmployeeIds
                              ? tC("warnings.employee_partial", {
                                  kept: plan.valid_target_employee_count,
                                  dropped: plan.total_employee_selections,
                                })
                              : tC("warnings.employee_dropped_all", {
                                  count: plan.rules_with_employee_selection,
                                })}
                          </p>
                        </div>
                      )}

                      {plan.source_rule_count === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-8 text-center">
                          <Copy className="w-8 h-8 text-gray-300 dark:text-slate-600" />
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {tC("empty.no_rules")}
                          </p>
                        </div>
                      ) : (
                        <div className="border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden">
                          <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-800">
                            {plan.rows.map((row) => (
                              <div
                                key={row.source_rule_id}
                                className="flex items-center gap-3 px-3.5 py-2.5"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                                    {row.rule_name}
                                  </p>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                    {row.context_key} &middot; {row.apply_to} &middot; {row.column_key}
                                    {row.dropped_employee_count > 0 && (
                                      <span className="text-amber-600 dark:text-amber-400">
                                        {" "}
                                        &middot; {tC("rows.employees_dropped", { count: row.dropped_employee_count })}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <span
                                  className={cn(
                                    "shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold",
                                    ROLE_BADGE[row.target_role] ?? "bg-gray-100 dark:bg-slate-800 text-gray-500"
                                  )}
                                >
                                  {row.target_role}
                                </span>
                                <span
                                  className={cn(
                                    "shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold",
                                    ACTION_BADGE[row.action]
                                  )}
                                >
                                  {tC(`rows.${row.action}`)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-5 sm:px-6 py-4 border-t border-gray-100 dark:border-slate-800 shrink-0">
              {result ? (
                <button
                  onClick={() => {
                    onCopied();
                    onClose();
                  }}
                  className="px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-400 text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  {t("common.done")}
                </button>
              ) : (
                <>
                  <button
                    onClick={onClose}
                    className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={() => setConfirmOpen(true)}
                    disabled={
                      copying ||
                      !plan ||
                      !hasRules ||
                      copiesNothing ||
                      (plan.to_create === 0 && plan.to_overwrite === 0)
                    }
                    className="px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-400 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {tC("buttons.copy")}
                  </button>
                </>
              )}
            </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      <ConfirmationModal
        isOpen={confirmOpen && !result}
        type="warning"
        title={tC("confirm.title")}
        message={
          plan
            ? tC("confirm.message", {
                source: plan.source_house.name,
                target: plan.target_house.name,
                create: plan.to_create,
              })
            : ""
        }
        confirmText={tC("buttons.copy_confirm")}
        loading={copying}
        onClose={() => {
          if (!copying) setConfirmOpen(false);
        }}
        onConfirm={runCopy}
      />
    </>
  );
}