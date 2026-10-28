"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import apiClient from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
    AlertTriangle,
    Banknote,
    Building2,
    Calendar,
    CheckCircle2,
    ExternalLink,
    Hash,
    Landmark,
    Loader2,
    RefreshCw,
    Wallet,
    X,
    XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLiftingAmount } from "@/lib/price";

const DMS_PRERF_URL = "https://blkdms.banglalink.net/PreRF";
const CONFIRMED_STATUSES = ["Confirmed", "Approved"];

export type PullBank = {
    id: number;
    name: string;
};

export type PullRecord = {
    id: number;
    house_id: number;
    lifting_date: string;
    total_bank_deposit: number;
    itopup_amount: number;
    status: string;
    bank_id?: number | null;
    bank_name?: string | null;
    deposit_slip?: string | null;
    pull_status?: string | null;
    pull_rf_code?: string | null;
    house?: { id: number; name?: string; display_name?: string } | null;
};

type PullJobResult = {
    outcome: string;
    message: string;
    rf_code?: string | null;
    rf_date?: string | null;
    rf_status?: string | null;
    total_price?: number | null;
    requisition_sum?: number | null;
    pulled_quantity?: number | null;
    available_amount?: number | null;
    required_amount?: number | null;
    shortfall_amount?: number | null;
    dry_run?: boolean;
};

type PullEvent = {
    code: string;
    msg: string;
    params?: Record<string, unknown>;
    ts?: number;
};

/** DMS cash-account balance check returned by ``POST lifting/{id}/pull/funds``. */
type PullFunds = {
    account_name?: string | null;
    account_code?: string | null;
    available_amount: number;
    required_amount: number;
    itopup_quantity: number;
    sufficient: boolean;
    extra_amount: number;
    max_itopup_quantity: number;
    max_total_price: number;
};

type Phase = "confirm" | "running" | "result";

type Props = {
    open: boolean;
    record: PullRecord | null;
    isAdmin: boolean;
    onClose: () => void;
    onCompleted: () => void;
};

const formatAmount = (value: number | null | undefined) =>
    Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

const floorQuantity = (value: number | null | undefined) =>
    Math.floor(Number(value || 0));

export default function PullPreRFModal({ open, record, isAdmin, onClose, onCompleted }: Props) {
    const { t } = useLanguage();
    const [phase, setPhase] = useState<Phase>("confirm");
    const [dryRun, setDryRun] = useState(false);
    const [starting, setStarting] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);
    const [events, setEvents] = useState<PullEvent[]>([]);
    const [result, setResult] = useState<PullJobResult | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [funds, setFunds] = useState<PullFunds | null>(null);
    const [fundsLoading, setFundsLoading] = useState(false);
    const [fundsError, setFundsError] = useState<string | null>(null);
    const [fundsRetry, setFundsRetry] = useState(0);
    const [useAvailable, setUseAvailable] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const startedAtRef = useRef<number | null>(null);
    const pollCancelledRef = useRef(false);

    const recordId = record?.id ?? null;

    useEffect(() => {
        if (open && recordId != null) {
            setPhase("confirm");
            setDryRun(false);
            setStarting(false);
            setJobId(null);
            setEvents([]);
            setResult(null);
            setErrorMessage(null);
            setFunds(null);
            setFundsError(null);
            setFundsLoading(false);
            setFundsRetry(0);
            setUseAvailable(false);
            setElapsed(0);
            startedAtRef.current = null;
            pollCancelledRef.current = false;
        }
    }, [open, recordId]);

    useEffect(() => {
        if (phase !== "running") return;
        const timer = setInterval(() => {
            if (startedAtRef.current) {
                setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [phase]);

    useEffect(() => {
        return () => {
            pollCancelledRef.current = true;
        };
    }, []);

    const issues = useMemo(() => {
        if (!record) return [];
        const list: string[] = [];
        if (!CONFIRMED_STATUSES.includes(record.status)) {
            list.push(t("liftings.pull.invalid_status"));
        }
        if (record.pull_status === "submitted") {
            list.push(t("liftings.pull.already_submitted"));
        }
        if (!record.bank_id) {
            list.push(t("liftings.pull.missing_bank"));
        }
        if (Number(record.total_bank_deposit || 0) <= 0) {
            list.push(t("liftings.pull.missing_amount"));
        }
        if (floorQuantity(record.itopup_amount) < 1) {
            list.push(t("liftings.pull.missing_qty"));
        }
        if (!record.deposit_slip) {
            list.push(t("liftings.pull.missing_slip"));
        }
        return list;
    }, [record, t]);

    // Check the DMS cash-account balance before letting the pull start: a pull
    // of N iTopUp consumes N x 0.9625 of that account.
    useEffect(() => {
        if (!open || recordId == null || issues.length > 0) {
            setFunds(null);
            setFundsLoading(false);
            setFundsError(null);
            return;
        }
        let cancelled = false;
        setFundsLoading(true);
        setFundsError(null);
        setFunds(null);
        setUseAvailable(false);
        apiClient
            .post(`lifting/${recordId}/pull/funds`, null, { timeout: 180000 })
            .then((res) => {
                if (!cancelled) setFunds(res.data as PullFunds);
            })
            .catch((err: any) => {
                if (cancelled) return;
                setFundsError(
                    err?.response?.data?.detail || err?.message || t("liftings.pull.balance_failed")
                );
            })
            .finally(() => {
                if (!cancelled) setFundsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, recordId, issues.length, fundsRetry]); // eslint-disable-line react-hooks/exhaustive-deps

    // The DMS holds more than this pull needs: the user may pull the whole
    // available balance instead.
    const hasExtra = !!funds && funds.sufficient && funds.extra_amount > 0 && funds.max_itopup_quantity > funds.itopup_quantity;

    const stepLabel = (event: PullEvent) => {
        const key = `liftings.pull.steps.${event.code}`;
        const translated = t(key);
        return translated === key ? event.msg : translated;
    };

    const handleStart = async () => {
        if (!record || issues.length > 0) return;
        setStarting(true);
        setErrorMessage(null);
        try {
            const res = await apiClient.post(`lifting/${record.id}/pull`, {
                dry_run: isAdmin ? dryRun : false,
                use_available_balance: useAvailable && hasExtra,
            });
            const newJobId = res.data?.job_id as string;
            if (!newJobId) {
                throw new Error(t("liftings.pull.start_failed"));
            }
            setJobId(newJobId);
            setEvents([]);
            setResult(null);
            setPhase("running");
            startedAtRef.current = Date.now();
            setElapsed(0);
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err?.message || t("liftings.pull.start_failed");
            setErrorMessage(detail);
            toast.error(detail);
        } finally {
            setStarting(false);
        }
    };

    useEffect(() => {
        if (phase !== "running" || !jobId) return;
        pollCancelledRef.current = false;

        const poll = async () => {
            while (!pollCancelledRef.current) {
                try {
                    const res = await apiClient.get(`lifting/pull/status/${jobId}`);
                    const data = res.data;
                    setEvents(Array.isArray(data?.events) ? data.events : []);

                    if (data?.status === "complete") {
                        setResult((data.result as PullJobResult) || null);
                        setPhase("result");
                        onCompleted();
                        return;
                    }
                    if (data?.status === "error") {
                        setResult(
                            (data.result as PullJobResult) || {
                                outcome: "failed",
                                message: data?.message || t("liftings.pull.failed_title"),
                            }
                        );
                        setPhase("result");
                        onCompleted();
                        return;
                    }
                    if (data?.status === "not_found") {
                        setErrorMessage(data?.message || t("common.error"));
                        setPhase("confirm");
                        return;
                    }
                } catch (err: any) {
                    setErrorMessage(
                        err?.response?.data?.detail || err?.message || t("common.error")
                    );
                    setPhase("confirm");
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        };

        poll();
        return () => {
            pollCancelledRef.current = true;
        };
    }, [phase, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!open || !record) return null;

    const houseName =
        record.house?.display_name || record.house?.name || `House #${record.house_id}`;
    const quantity = floorQuantity(record.itopup_amount);
    const outcome = result?.outcome;

    const resultTheme = (() => {
        if (outcome === "created") {
            return {
                icon: CheckCircle2,
                color: "text-emerald-500",
                bg: "bg-emerald-50 dark:bg-emerald-500/10",
                title: t("liftings.pull.success_title"),
            };
        }
        if (outcome === "dry_run_ok") {
            return {
                icon: CheckCircle2,
                color: "text-blue-500",
                bg: "bg-blue-50 dark:bg-blue-500/10",
                title: t("liftings.pull.dry_run_title"),
            };
        }
        if (outcome === "blocked_pending") {
            return {
                icon: AlertTriangle,
                color: "text-amber-500",
                bg: "bg-amber-50 dark:bg-amber-500/10",
                title: t("liftings.pull.pending_title"),
            };
        }
        if (outcome === "blocked_rejected") {
            return {
                icon: XCircle,
                color: "text-red-500",
                bg: "bg-red-50 dark:bg-red-500/10",
                title: t("liftings.pull.rejected_title"),
            };
        }
        if (outcome === "insufficient_balance") {
            return {
                icon: AlertTriangle,
                color: "text-red-500",
                bg: "bg-red-50 dark:bg-red-500/10",
                title: t("liftings.pull.balance_short_title"),
            };
        }
        return {
            icon: XCircle,
            color: "text-red-500",
            bg: "bg-red-50 dark:bg-red-500/10",
            title: t("liftings.pull.failed_title"),
        };
    })();

    const ResultIcon = resultTheme.icon;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4"
                onClick={phase === "running" ? undefined : onClose}
            >
                <motion.div
                    initial={{ scale: 0.96, opacity: 0, y: 8 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.96, opacity: 0, y: 8 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 max-h-[92dvh] flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 rounded-xl bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-300 shrink-0">
                                <Landmark className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                                    {t("liftings.pull.title")}
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {houseName} • #{record.id}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            disabled={phase === "running"}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label={t("liftings.pull.close")}
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 space-y-4">
                        {phase === "confirm" && (
                            <>
                                <div className="space-y-2.5">
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                                            <Calendar className="w-3.5 h-3.5" />
                                            {t("liftings.pull.lifting_date")}
                                        </span>
                                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                                            {record.lifting_date}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                                            <Landmark className="w-3.5 h-3.5" />
                                            {t("liftings.pull.bank")}
                                        </span>
                                        <span className="font-semibold text-gray-900 dark:text-gray-100 text-right">
                                            {record.bank_name || "—"}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                                            <Banknote className="w-3.5 h-3.5" />
                                            {t("liftings.pull.deposit")}
                                        </span>
                                        <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
                                            {formatAmount(record.total_bank_deposit)}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                                            <Hash className="w-3.5 h-3.5" />
                                            {t("liftings.pull.quantity")}
                                        </span>
                                        <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
                                            {(useAvailable && hasExtra && funds
                                                ? funds.max_itopup_quantity
                                                : quantity
                                            ).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                                            <Building2 className="w-3.5 h-3.5" />
                                            {t("liftings.pull.warehouse")}
                                        </span>
                                        <span className="font-semibold text-gray-900 dark:text-gray-100 text-right">
                                            {t("liftings.pull.warehouse_value")}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="text-gray-500 dark:text-gray-400">
                                            {t("liftings.pull.slip")}
                                        </span>
                                        <span
                                            className={cn(
                                                "text-xs font-bold px-2 py-0.5 rounded-full",
                                                record.deposit_slip
                                                    ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
                                                    : "bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-300"
                                            )}
                                        >
                                            {record.deposit_slip
                                                ? t("liftings.pull.slip_ready")
                                                : t("liftings.pull.slip_missing")}
                                        </span>
                                    </div>
                                    {record.pull_rf_code && (
                                        <div className="flex items-center justify-between gap-3 text-sm">
                                            <span className="text-gray-500 dark:text-gray-400">
                                                {t("liftings.pull.rf_code")}
                                            </span>
                                            <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
                                                {record.pull_rf_code}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {issues.length === 0 && (
                                    <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3.5 space-y-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
                                                <Wallet className="w-4 h-4 text-primary-500 shrink-0" />
                                                {t("liftings.pull.balance_title")}
                                            </p>
                                            {fundsError && (
                                                <button
                                                    onClick={() => setFundsRetry((n) => n + 1)}
                                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
                                                >
                                                    <RefreshCw className="w-3 h-3" />
                                                    {t("liftings.pull.balance_retry")}
                                                </button>
                                            )}
                                        </div>

                                        {fundsLoading ? (
                                            <div className="space-y-2 animate-pulse">
                                                <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                                                <div className="h-3 w-52 bg-gray-100 dark:bg-slate-800 rounded-md" />
                                                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                                    {t("liftings.pull.balance_checking")}
                                                </p>
                                            </div>
                                        ) : fundsError ? (
                                            <p className="text-xs text-red-600 dark:text-red-300">{fundsError}</p>
                                        ) : funds ? (
                                            <>
                                                {funds.account_name && (
                                                    <div className="flex items-center justify-between gap-3 text-xs">
                                                        <span className="text-gray-500 dark:text-gray-400">
                                                            {t("liftings.pull.balance_account")}
                                                        </span>
                                                        <span className="font-mono font-semibold text-gray-800 dark:text-gray-200 text-right">
                                                            {funds.account_name}
                                                            {funds.account_code ? ` (${funds.account_code})` : ""}
                                                        </span>
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between gap-3 text-xs">
                                                    <span className="text-gray-500 dark:text-gray-400">
                                                        {t("liftings.pull.balance_available")}
                                                    </span>
                                                    <span className="font-mono font-bold text-gray-900 dark:text-gray-100">
                                                        {formatLiftingAmount(funds.available_amount)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-3 text-xs">
                                                    <span className="text-gray-500 dark:text-gray-400">
                                                        {t("liftings.pull.balance_required")}
                                                    </span>
                                                    <span className="font-mono font-bold text-gray-900 dark:text-gray-100">
                                                        {formatLiftingAmount(funds.required_amount)}
                                                    </span>
                                                </div>

                                                {!funds.sufficient ? (
                                                    <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20">
                                                        <p className="text-xs font-bold text-red-600 dark:text-red-300">
                                                            {t("liftings.pull.balance_short_title")}
                                                        </p>
                                                        <p className="mt-1 text-[11px] text-red-600/90 dark:text-red-300/90">
                                                            {t("liftings.pull.balance_short_hint", {
                                                                amount: formatLiftingAmount(funds.required_amount - funds.available_amount),
                                                            })}
                                                        </p>
                                                    </div>
                                                ) : hasExtra ? (
                                                    <>
                                                        <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20">
                                                            <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                                                                {t("liftings.pull.balance_extra_title")}
                                                            </p>
                                                            <p className="mt-1 text-[11px] text-amber-700/90 dark:text-amber-300/90">
                                                                {t("liftings.pull.balance_extra_hint", {
                                                                    amount: formatLiftingAmount(funds.extra_amount),
                                                                    qty: funds.max_itopup_quantity.toLocaleString(),
                                                                    total: formatLiftingAmount(funds.max_total_price),
                                                                })}
                                                            </p>
                                                        </div>
                                                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-gray-200 dark:border-slate-700 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={useAvailable}
                                                                onChange={(e) => setUseAvailable(e.target.checked)}
                                                                className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
                                                            />
                                                            <span>
                                                                <span className="block text-xs font-semibold text-gray-800 dark:text-gray-200">
                                                                    {t("liftings.pull.balance_extra_toggle")}
                                                                </span>
                                                                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                                                                    {t("liftings.pull.balance_extra_toggle_hint", {
                                                                        qty: funds.max_itopup_quantity.toLocaleString(),
                                                                    })}
                                                                </span>
                                                            </span>
                                                        </label>
                                                    </>
                                                ) : (
                                                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                                        {t("liftings.pull.balance_ok")}
                                                    </p>
                                                )}
                                            </>
                                        ) : null}
                                    </div>
                                )}

                                {issues.length > 0 && (
                                    <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20">
                                        <p className="flex items-center gap-2 text-sm font-bold text-amber-700 dark:text-amber-300">
                                            <AlertTriangle className="w-4 h-4 shrink-0" />
                                            {t("liftings.pull.missing_title")}
                                        </p>
                                        <ul className="mt-2 space-y-1 pl-6 list-disc">
                                            {issues.map((issue) => (
                                                <li
                                                    key={issue}
                                                    className="text-xs text-amber-700 dark:text-amber-300"
                                                >
                                                    {issue}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {errorMessage && (
                                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-xs text-red-600 dark:text-red-300">
                                        {errorMessage}
                                    </div>
                                )}

                                {isAdmin && (
                                    <label className="flex items-start gap-2.5 p-3 rounded-xl border border-gray-200 dark:border-slate-700 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={dryRun}
                                            onChange={(e) => setDryRun(e.target.checked)}
                                            className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
                                        />
                                        <span>
                                            <span className="block text-sm font-semibold text-gray-800 dark:text-gray-200">
                                                {t("liftings.pull.dry_run")}
                                            </span>
                                            <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                                                {t("liftings.pull.dry_run_hint")}
                                            </span>
                                        </span>
                                    </label>
                                )}
                            </>
                        )}

                        {phase === "running" && (
                            <>
                                <div className="flex items-center gap-3">
                                    <Loader2 className="w-5 h-5 animate-spin text-primary-500 shrink-0" />
                                    <div>
                                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                            {t("liftings.pull.running_title")}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {t("liftings.pull.running_subtitle")}
                                        </p>
                                    </div>
                                </div>

                                <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                                    <div className="h-full w-1/2 rounded-full bg-primary-500 animate-pulse" />
                                </div>

                                <div className="rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800/60 max-h-56 overflow-y-auto">
                                    {events.length === 0 && (
                                        <p className="px-3.5 py-3 text-xs text-gray-400">
                                            {t("liftings.pull.starting")}
                                        </p>
                                    )}
                                    {[...events].reverse().map((event, index) => {
                                        const isLatest = index === 0;
                                        const originalIndex = events.length - 1 - index;
                                        return (
                                            <div
                                                key={`${event.code}-${originalIndex}`}
                                                className="flex items-start gap-2.5 px-3.5 py-2.5"
                                            >
                                                {isLatest ? (
                                                    <Loader2 className="mt-0.5 w-3.5 h-3.5 animate-spin text-primary-500 shrink-0" />
                                                ) : (
                                                    <CheckCircle2 className="mt-0.5 w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                                )}
                                                <p
                                                    className={cn(
                                                        "text-xs",
                                                        isLatest
                                                            ? "text-gray-700 dark:text-gray-200 font-medium"
                                                            : "text-gray-500 dark:text-gray-400"
                                                    )}
                                                >
                                                    {stepLabel(event)}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>

                                <p className="text-[11px] text-gray-400 text-center">
                                    {t("liftings.pull.elapsed", { time: `${elapsed}s` })}
                                </p>
                            </>
                        )}

                        {phase === "result" && result && (
                            <>
                                <div className={cn("p-4 rounded-xl", resultTheme.bg)}>
                                    <div className="flex items-start gap-3">
                                        <ResultIcon
                                            className={cn("w-6 h-6 shrink-0", resultTheme.color)}
                                        />
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                                {resultTheme.title}
                                            </p>
                                            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-line">
                                                {result.message}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {outcome === "insufficient_balance" && (
                                    <div className="rounded-xl border border-red-100 dark:border-red-500/20 divide-y divide-red-100 dark:divide-red-500/20">
                                        {result.available_amount != null && (
                                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
                                                <span className="text-gray-500 dark:text-gray-400">
                                                    {t("liftings.pull.balance_available")}
                                                </span>
                                                <span className="font-mono font-bold text-gray-900 dark:text-gray-100">
                                                    {formatLiftingAmount(result.available_amount)}
                                                </span>
                                            </div>
                                        )}
                                        {result.required_amount != null && (
                                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
                                                <span className="text-gray-500 dark:text-gray-400">
                                                    {t("liftings.pull.balance_required")}
                                                </span>
                                                <span className="font-mono font-bold text-gray-900 dark:text-gray-100">
                                                    {formatLiftingAmount(result.required_amount)}
                                                </span>
                                            </div>
                                        )}
                                        {result.shortfall_amount != null && (
                                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
                                                <span className="text-gray-500 dark:text-gray-400">
                                                    {t("liftings.pull.balance_short_by")}
                                                </span>
                                                <span className="font-mono font-bold text-red-600 dark:text-red-300">
                                                    {formatLiftingAmount(result.shortfall_amount)}
                                                </span>
                                            </div>
                                        )}
                                        <p className="px-3.5 py-2.5 text-[11px] text-red-600/90 dark:text-red-300/90">
                                            {t("liftings.pull.balance_short_stopped")}
                                        </p>
                                    </div>
                                )}

                                {(result.rf_code || result.rf_date || result.rf_status) && (
                                    <div className="rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800/60">
                                        {result.rf_code && (
                                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                                                <span className="text-gray-500 dark:text-gray-400">
                                                    {t("liftings.pull.rf_code")}
                                                </span>
                                                <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
                                                    {result.rf_code}
                                                </span>
                                            </div>
                                        )}
                                        {result.rf_date && (
                                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                                                <span className="text-gray-500 dark:text-gray-400">
                                                    {t("liftings.pull.rf_date")}
                                                </span>
                                                <span className="font-semibold text-gray-900 dark:text-gray-100">
                                                    {result.rf_date}
                                                </span>
                                            </div>
                                        )}
                                        {result.rf_status && (
                                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                                                <span className="text-gray-500 dark:text-gray-400">
                                                    {t("liftings.pull.rf_status")}
                                                </span>
                                                <span className="font-semibold text-gray-900 dark:text-gray-100">
                                                    {result.rf_status}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {(result.total_price != null || result.requisition_sum != null) && (
                                    <div className="rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800/60">
                                        {result.total_price != null && (
                                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                                                <span className="text-gray-500 dark:text-gray-400">
                                                    {t("liftings.pull.total_price")}
                                                </span>
                                                <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
                                                    {formatAmount(result.total_price)}
                                                </span>
                                            </div>
                                        )}
                                        {result.pulled_quantity != null && (
                                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                                                <span className="text-gray-500 dark:text-gray-400">
                                                    {t("liftings.pull.pulled_quantity")}
                                                </span>
                                                <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
                                                    {Number(result.pulled_quantity).toLocaleString()}
                                                </span>
                                            </div>
                                        )}
                                        {result.requisition_sum != null && (
                                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                                                <span className="text-gray-500 dark:text-gray-400">
                                                    {t("liftings.pull.requisition_sum")}
                                                </span>
                                                <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
                                                    {formatAmount(result.requisition_sum)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <a
                                    href={DMS_PRERF_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    {t("liftings.pull.view_dms")}
                                </a>
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 dark:border-slate-800">
                        {phase === "confirm" && (
                            <>
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                >
                                    {t("liftings.pull.cancel")}
                                </button>
                                <button
                                    onClick={handleStart}
                                    disabled={starting || issues.length > 0 || !funds || !funds.sufficient}
                                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-primary-600 text-white hover:bg-primary-700 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {starting && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {t("liftings.pull.start")}
                                </button>
                            </>
                        )}
                        {phase === "running" && (
                            <button
                                disabled
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gray-100 dark:bg-slate-800 text-gray-400 cursor-not-allowed"
                            >
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {t("liftings.pull.running_title")}
                            </button>
                        )}
                        {phase === "result" && (
                            <>
                                {outcome !== "created" && outcome !== "blocked_pending" && outcome !== "blocked_rejected" && (
                                    <button
                                        onClick={() => {
                                            setPhase("confirm");
                                            setResult(null);
                                            setEvents([]);
                                            setJobId(null);
                                        }}
                                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                        {t("liftings.pull.recheck")}
                                    </button>
                                )}
                                <button
                                    onClick={onClose}
                                    className="px-5 py-2.5 rounded-xl text-sm font-bold bg-primary-600 text-white hover:bg-primary-700 transition-all cursor-pointer shadow-sm"
                                >
                                    {t("liftings.pull.close")}
                                </button>
                            </>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
