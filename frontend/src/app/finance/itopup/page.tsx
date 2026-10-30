"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightLeft,
  BadgeCheck,
  Loader2,
  Plus,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { toast } from "react-hot-toast";

import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import {
  EmptyState,
  Field,
  FieldError,
  Modal,
  Pagination,
  StatusPill,
  SummaryCard,
  TableSkeleton,
  apiError,
  btnIcon,
  btnPrimary,
  btnSecondary,
  cardClass,
  formatDateTime,
  inputClass,
  money,
  selectClass,
  todayISO,
  type PaginationMeta,
} from "@/components/finance/ui";

interface BalanceRow {
  employee_id: number | null;
  employee_name: string;
  balance: number;
}

interface HolderRow {
  employee_id: number | null;
  employee_name: string;
  opening_balance: number;
  received: number;
  used: number;
  returned: number;
  adjustment: number;
  closing_balance: number;
  expected_closing: number;
}

interface EntryRow {
  id: number;
  employee_id: number | null;
  employee_name: string;
  entry_type: string;
  amount: number;
  reference: string | null;
  report_source: string;
  is_verified: boolean;
  verified_amount: number | null;
  discrepancy: number;
  notes: string | null;
}

interface Reconciliation {
  business_date: string;
  holders: HolderRow[];
  entries: EntryRow[];
}

interface TransferRow {
  id: number;
  from_employee_id: number | null;
  from_employee_name: string;
  to_employee_id: number | null;
  to_employee_name: string;
  amount: number;
  movement: string;
  notes: string | null;
  created_at: string | null;
}

interface EmployeeOption {
  id: number;
  employee_name: string | null;
  employee_id: string | null;
  employee_type: string | null;
}

const EMPTY_ENTRY = {
  employee_id: "mother",
  business_date: todayISO(),
  entry_type: "usage",
  amount: "",
  reference: "",
  report_source: "manual",
  notes: "",
};

const EMPTY_TRANSFER = {
  from: "mother",
  to: "",
  amount: "",
  movement: "other",
  notes: "",
};

type Tab = "balances" | "reconciliation" | "transfers";

export default function ITopUpPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [tab, setTab] = useState<Tab>("balances");

  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [reconDate, setReconDate] = useState(todayISO());
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [reconLoading, setReconLoading] = useState(false);

  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [transferPage, setTransferPage] = useState(1);
  const [transferPagination, setTransferPagination] = useState<PaginationMeta | null>(null);
  const [transfersLoading, setTransfersLoading] = useState(false);

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const [showEntry, setShowEntry] = useState(false);
  const [entryForm, setEntryForm] = useState({ ...EMPTY_ENTRY });
  const [entryErrors, setEntryErrors] = useState<Record<string, string>>({});
  const [entryError, setEntryError] = useState<string | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);

  const [showTransfer, setShowTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({ ...EMPTY_TRANSFER });
  const [transferErrors, setTransferErrors] = useState<Record<string, string>>({});
  const [transferError, setTransferError] = useState<string | null>(null);
  const [savingTransfer, setSavingTransfer] = useState(false);

  const [verifyTarget, setVerifyTarget] = useState<EntryRow | null>(null);
  const [verifyAmount, setVerifyAmount] = useState("");
  const [verifyNotes, setVerifyNotes] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const canCreate = hasPermission("itopup_balance.create");
  const canVerify = hasPermission("itopup_balance.verify");

  const headers = houseId ? { "X-House-ID": String(houseId) } : {};

  const fetchBalances = useCallback(
    async (silent = false) => {
      if (!houseId) {
        setBalancesLoading(false);
        return;
      }
      if (silent) setRefreshing(true);
      else setBalancesLoading(true);
      try {
        const res = await apiClient.get("/v1/finance/itopup/balances", { headers });
        setBalances(res.data?.data || []);
      } catch (err) {
        toast.error(apiError(err, t("finance.common.error_generic")).message);
      } finally {
        setBalancesLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseId, t]
  );

  const fetchReconciliation = useCallback(async () => {
    if (!houseId) return;
    setReconLoading(true);
    try {
      const res = await apiClient.get("/v1/finance/itopup/reconciliation", {
        params: { date: reconDate },
        headers,
      });
      setRecon(res.data?.data || null);
    } catch (err) {
      toast.error(apiError(err, t("finance.common.error_generic")).message);
      setRecon(null);
    } finally {
      setReconLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId, reconDate, t]);

  const fetchTransfers = useCallback(async () => {
    if (!houseId) return;
    setTransfersLoading(true);
    try {
      const res = await apiClient.get("/v1/finance/itopup/transfers", {
        params: { page: transferPage, per_page: 20 },
        headers,
      });
      setTransfers(res.data?.data || []);
      setTransferPagination(res.data?.pagination || null);
    } catch (err) {
      toast.error(apiError(err, t("finance.common.error_generic")).message);
    } finally {
      setTransfersLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId, transferPage, t]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  useEffect(() => {
    if (!houseId) return;
    apiClient
      .get("/v1/finance/employees", { headers })
      .then((res) => setEmployees(res.data?.data || []))
      .catch(() => setEmployees([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId]);

  useEffect(() => {
    if (tab === "reconciliation") fetchReconciliation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, reconDate, houseId]);

  useEffect(() => {
    if (tab === "transfers") fetchTransfers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, transferPage, houseId]);

  const refreshAll = async () => {
    await fetchBalances(true);
    if (tab === "reconciliation") await fetchReconciliation();
    if (tab === "transfers") await fetchTransfers();
  };

  const openEntry = () => {
    setEntryForm({ ...EMPTY_ENTRY, business_date: reconDate || todayISO() });
    setEntryErrors({});
    setEntryError(null);
    setShowEntry(true);
  };

  const submitEntry = async () => {
    const errors: Record<string, string> = {};
    const amount = Number(entryForm.amount);
    if (!entryForm.amount || Number.isNaN(amount) || amount <= 0) {
      errors.amount = t("finance.itopup.validation.amount");
    }
    if (!entryForm.entry_type) errors.entry_type = t("finance.common.required_field");
    if (Object.keys(errors).length) {
      setEntryErrors(errors);
      return;
    }

    setSavingEntry(true);
    setEntryError(null);
    try {
      await apiClient.post(
        "/v1/finance/itopup/entries",
        {
          employee_id: entryForm.employee_id === "mother" ? null : Number(entryForm.employee_id),
          business_date: entryForm.business_date || null,
          entry_type: entryForm.entry_type,
          amount,
          reference: entryForm.reference.trim() || null,
          report_source: entryForm.report_source,
          notes: entryForm.notes.trim() || null,
        },
        { headers }
      );
      toast.success(t("finance.itopup.entry_created"));
      setShowEntry(false);
      await fetchBalances(true);
      await fetchReconciliation();
      setTab("reconciliation");
    } catch (err) {
      const { message, fields } = apiError(err, t("finance.common.error_generic"));
      setEntryError(message);
      if (fields) setEntryErrors(fields);
    } finally {
      setSavingEntry(false);
    }
  };

  const openTransfer = () => {
    setTransferForm({ ...EMPTY_TRANSFER });
    setTransferErrors({});
    setTransferError(null);
    setShowTransfer(true);
  };

  const submitTransfer = async () => {
    const errors: Record<string, string> = {};
    if (transferForm.from === "" && transferForm.to === "") {
      errors.to = t("finance.itopup.validation.transfer_party");
    }
    if (transferForm.from !== "" && transferForm.from === transferForm.to) {
      errors.to = t("finance.itopup.validation.same_party");
    }
    const amount = Number(transferForm.amount);
    if (!transferForm.amount || Number.isNaN(amount) || amount <= 0) {
      errors.amount = t("finance.itopup.validation.amount");
    }
    if (Object.keys(errors).length) {
      setTransferErrors(errors);
      return;
    }

    setSavingTransfer(true);
    setTransferError(null);
    try {
      await apiClient.post(
        "/v1/finance/itopup/transfers",
        {
          from_employee_id:
            transferForm.from === "mother" || transferForm.from === ""
              ? null
              : Number(transferForm.from),
          to_employee_id:
            transferForm.to === "mother" || transferForm.to === ""
              ? null
              : Number(transferForm.to),
          amount,
          movement: transferForm.movement,
          notes: transferForm.notes.trim() || null,
        },
        { headers }
      );
      toast.success(t("finance.itopup.transfer_created"));
      setShowTransfer(false);
      await fetchBalances(true);
      if (tab === "transfers") await fetchTransfers();
    } catch (err) {
      const { message, fields } = apiError(err, t("finance.common.error_generic"));
      setTransferError(message);
      if (fields) setTransferErrors(fields);
    } finally {
      setSavingTransfer(false);
    }
  };

  const openVerify = (entry: EntryRow) => {
    setVerifyTarget(entry);
    setVerifyAmount(entry.verified_amount !== null ? String(entry.verified_amount) : String(entry.amount));
    setVerifyNotes("");
    setVerifyError(null);
  };

  const submitVerify = async () => {
    if (!verifyTarget) return;
    const amount = Number(verifyAmount);
    if (verifyAmount === "" || Number.isNaN(amount) || amount < 0) {
      setVerifyError(t("finance.itopup.validation.verified_amount"));
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    try {
      await apiClient.post(
        `/v1/finance/itopup/entries/${verifyTarget.id}/verify`,
        { verified_amount: amount, notes: verifyNotes.trim() || null },
        { headers }
      );
      toast.success(t("finance.itopup.verified_toast"));
      setVerifyTarget(null);
      await fetchReconciliation();
    } catch (err) {
      const { message } = apiError(err, t("finance.common.error_generic"));
      setVerifyError(message);
    } finally {
      setVerifying(false);
    }
  };

  const motherBalance = balances.find((row) => row.employee_id === null)?.balance ?? 0;
  const holderBalances = balances.filter((row) => row.employee_id !== null);
  const totalHolderBalance = holderBalances.reduce((sum, row) => sum + Number(row.balance || 0), 0);
  const totalUsed = (recon?.holders || []).reduce((sum, row) => sum + Number(row.used || 0), 0);
  const totalReturned = (recon?.holders || []).reduce((sum, row) => sum + Number(row.returned || 0), 0);
  const totalAdjustment = (recon?.holders || []).reduce((sum, row) => sum + Number(row.adjustment || 0), 0);
  const totalClosing = (recon?.holders || []).reduce((sum, row) => sum + Number(row.closing_balance || 0), 0);

  const employeeLabel = (employee: EmployeeOption) =>
    `${employee.employee_name || employee.employee_id || `#${employee.id}`}${
      employee.employee_type ? ` (${employee.employee_type})` : ""
    }`;

  if (!hasPermission("itopup_balance.view")) return <AccessDenied />;

  const tabs: { key: Tab; label: string }[] = [
    { key: "balances", label: t("finance.itopup.tabs.balances") },
    { key: "reconciliation", label: t("finance.itopup.tabs.reconciliation") },
    { key: "transfers", label: t("finance.itopup.tabs.transfers") },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-500/20 rounded-xl">
          <Smartphone className="w-5 h-5 text-violet-600 dark:text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("finance.itopup.title")}
            </h1>
            <PageGuideModal pageKey="finance.itopup" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("finance.itopup.description")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={refreshAll}
            className={btnIcon}
            title={t("finance.common.refresh")}
            aria-label={t("finance.common.refresh")}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          {canCreate ? (
            <>
              <button type="button" onClick={openTransfer} className={btnSecondary}>
                <ArrowRightLeft className="w-4 h-4" />
                {t("finance.itopup.new_transfer")}
              </button>
              <button type="button" onClick={openEntry} className={btnPrimary}>
                <Plus className="w-4 h-4" />
                {t("finance.itopup.new_entry")}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {!houseId ? (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          {t("finance.common.require_house")}
        </div>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-gray-100 dark:border-slate-800">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap cursor-pointer border-b-2 -mb-px transition-colors ${
                  tab === item.key
                    ? "border-primary-500 text-primary-600 dark:text-primary-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "balances" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SummaryCard
                  label={t("finance.itopup.mother_sim")}
                  value={money(motherBalance)}
                  tone="violet"
                />
                <SummaryCard
                  label={t("finance.itopup.total_holder_balance")}
                  value={money(totalHolderBalance)}
                  tone="emerald"
                />
                <SummaryCard
                  label={t("finance.itopup.holders")}
                  value={String(holderBalances.length)}
                  tone="slate"
                />
              </div>

              <div className={cardClass}>
                <div className="px-4 py-3 border-b border-gray-50 dark:border-slate-800">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    {t("finance.itopup.balances_title")}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t("finance.itopup.balances_desc")}
                  </p>
                </div>
                {balancesLoading ? (
                  <TableSkeleton rows={5} />
                ) : balances.length === 0 ? (
                  <EmptyState
                    title={t("finance.itopup.empty_balances")}
                    description={t("finance.itopup.empty_balances_desc")}
                  />
                ) : (
                  <>
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          <tr>
                            <th className="px-2 py-2">{t("finance.itopup.holder")}</th>
                            <th className="px-2 py-2">{t("finance.itopup.holder_type")}</th>
                            <th className="px-2 py-2 text-right">{t("finance.itopup.balance")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                          {balances.map((row) => (
                            <tr
                              key={row.employee_id ?? "mother"}
                              className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40"
                            >
                              <td className="px-2 py-1 font-medium">{row.employee_name}</td>
                              <td className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
                                {row.employee_id === null
                                  ? t("finance.itopup.mother_sim")
                                  : t("finance.itopup.rso")}
                              </td>
                              <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                                {money(row.balance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {balances.map((row) => (
                        <div
                          key={row.employee_id ?? "mother"}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{row.employee_name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {row.employee_id === null
                                ? t("finance.itopup.mother_sim")
                                : t("finance.itopup.rso")}
                            </p>
                          </div>
                          <p className="text-sm font-bold shrink-0">{money(row.balance)}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : null}

          {tab === "reconciliation" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                  {t("finance.common.business_date")}
                </label>
                <input
                  type="date"
                  value={reconDate}
                  max={todayISO()}
                  onChange={(event) => setReconDate(event.target.value || todayISO())}
                  className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <SummaryCard label={t("finance.itopup.used")} value={money(totalUsed)} tone="rose" />
                <SummaryCard
                  label={t("finance.itopup.returned")}
                  value={money(totalReturned)}
                  tone="amber"
                />
                <SummaryCard
                  label={t("finance.itopup.adjustment")}
                  value={money(totalAdjustment)}
                  tone="blue"
                />
                <SummaryCard
                  label={t("finance.itopup.closing_balance")}
                  value={money(totalClosing)}
                  tone="violet"
                />
              </div>

              <div className={cardClass}>
                <div className="px-4 py-3 border-b border-gray-50 dark:border-slate-800">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    {t("finance.itopup.holders_title")}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t("finance.itopup.holders_desc")}
                  </p>
                </div>
                {reconLoading ? (
                  <TableSkeleton rows={4} />
                ) : !recon || recon.holders.length === 0 ? (
                  <EmptyState
                    title={t("finance.itopup.empty_recon")}
                    description={t("finance.itopup.empty_recon_desc")}
                  />
                ) : (
                  <>
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          <tr>
                            <th className="px-2 py-2">{t("finance.itopup.holder")}</th>
                            <th className="px-2 py-2 text-right">{t("finance.itopup.opening")}</th>
                            <th className="px-2 py-2 text-right">{t("finance.itopup.used")}</th>
                            <th className="px-2 py-2 text-right">{t("finance.itopup.returned")}</th>
                            <th className="px-2 py-2 text-right">{t("finance.itopup.adjustment")}</th>
                            <th className="px-2 py-2 text-right">{t("finance.itopup.closing_balance")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                          {recon.holders.map((row) => (
                            <tr key={row.employee_id ?? "mother"}>
                              <td className="px-2 py-1 font-medium">{row.employee_name}</td>
                              <td className="px-2 py-1 text-right whitespace-nowrap">
                                {money(row.opening_balance)}
                              </td>
                              <td className="px-2 py-1 text-right whitespace-nowrap text-rose-600 dark:text-rose-400">
                                {money(row.used)}
                              </td>
                              <td className="px-2 py-1 text-right whitespace-nowrap text-amber-600 dark:text-amber-400">
                                {money(row.returned)}
                              </td>
                              <td className="px-2 py-1 text-right whitespace-nowrap">
                                {money(row.adjustment)}
                              </td>
                              <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                                {money(row.closing_balance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {recon.holders.map((row) => (
                        <div key={row.employee_id ?? "mother"} className="px-4 py-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-sm">{row.employee_name}</p>
                            <p className="text-sm font-bold">{money(row.closing_balance)}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                            <span>
                              {t("finance.itopup.opening")}: {money(row.opening_balance)}
                            </span>
                            <span>
                              {t("finance.itopup.used")}: {money(row.used)}
                            </span>
                            <span>
                              {t("finance.itopup.returned")}: {money(row.returned)}
                            </span>
                            <span>
                              {t("finance.itopup.adjustment")}: {money(row.adjustment)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className={cardClass}>
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-50 dark:border-slate-800">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    {t("finance.itopup.entries_title")}
                  </p>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {recon?.entries.length ?? 0} {t("finance.common.records")}
                  </span>
                </div>
                {reconLoading ? (
                  <TableSkeleton rows={4} />
                ) : !recon || recon.entries.length === 0 ? (
                  <EmptyState
                    title={t("finance.itopup.empty_entries")}
                    description={t("finance.itopup.empty_entries_desc")}
                  />
                ) : (
                  <>
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          <tr>
                            <th className="px-2 py-2">{t("finance.itopup.holder")}</th>
                            <th className="px-2 py-2">{t("finance.itopup.entry_type")}</th>
                            <th className="px-2 py-2 text-right">{t("finance.common.amount")}</th>
                            <th className="px-2 py-2">{t("finance.common.reference")}</th>
                            <th className="px-2 py-2">{t("finance.itopup.source")}</th>
                            <th className="px-2 py-2">{t("finance.common.status")}</th>
                            <th className="px-2 py-2 text-right">{t("finance.common.actions")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                          {recon.entries.map((entry) => (
                            <tr key={entry.id} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40">
                              <td className="px-2 py-1 font-medium">{entry.employee_name}</td>
                              <td className="px-2 py-1 text-xs capitalize">
                                {t(`finance.common.entry_types.${entry.entry_type}`)}
                              </td>
                              <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                                {money(entry.amount)}
                              </td>
                              <td className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
                                {entry.reference || "—"}
                              </td>
                              <td className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
                                {entry.report_source === "dms_report"
                                  ? t("finance.itopup.from_report")
                                  : t("finance.itopup.manual")}
                              </td>
                              <td className="px-2 py-1">
                                <StatusPill status={entry.is_verified ? "verified" : "unverified"} />
                                {entry.is_verified && entry.discrepancy !== 0 ? (
                                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                                    {money(entry.verified_amount)} ({money(entry.discrepancy)})
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-2 py-1 text-right">
                                {canVerify ? (
                                  <button
                                    type="button"
                                    onClick={() => openVerify(entry)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                                  >
                                    <BadgeCheck className="w-3.5 h-3.5" />
                                    {t("finance.itopup.verify")}
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-gray-400">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {recon.entries.map((entry) => (
                        <div key={entry.id} className="px-4 py-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{entry.employee_name}</p>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 capitalize">
                                {t(`finance.common.entry_types.${entry.entry_type}`)} •{" "}
                                {entry.report_source === "dms_report"
                                  ? t("finance.itopup.from_report")
                                  : t("finance.itopup.manual")}
                              </p>
                            </div>
                            <p className="text-sm font-bold shrink-0">{money(entry.amount)}</p>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <StatusPill status={entry.is_verified ? "verified" : "unverified"} />
                            {canVerify ? (
                              <button
                                type="button"
                                onClick={() => openVerify(entry)}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold cursor-pointer"
                              >
                                <BadgeCheck className="w-3.5 h-3.5" />
                                {t("finance.itopup.verify")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : null}

          {tab === "transfers" ? (
            <div className={cardClass}>
              <div className="px-4 py-3 border-b border-gray-50 dark:border-slate-800">
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {t("finance.itopup.transfers_title")}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {t("finance.itopup.transfers_desc")}
                </p>
              </div>
              {transfersLoading ? (
                <TableSkeleton rows={5} />
              ) : transfers.length === 0 ? (
                <EmptyState
                  title={t("finance.itopup.empty_transfers")}
                  description={t("finance.itopup.empty_transfers_desc")}
                />
              ) : (
                <>
                  <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        <tr>
                          <th className="px-2 py-2">{t("finance.common.date")}</th>
                          <th className="px-2 py-2">{t("finance.itopup.from")}</th>
                          <th className="px-2 py-2">{t("finance.itopup.to")}</th>
                          <th className="px-2 py-2 text-right">{t("finance.common.amount")}</th>
                          <th className="px-2 py-2">{t("finance.itopup.movement")}</th>
                          <th className="px-2 py-2">{t("finance.common.notes")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                        {transfers.map((row) => (
                          <tr key={row.id}>
                            <td className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                              {formatDateTime(row.created_at)}
                            </td>
                            <td className="px-2 py-1 font-medium">
                              {row.from_employee_name || t("finance.itopup.mother_sim")}
                            </td>
                            <td className="px-2 py-1 font-medium">
                              {row.to_employee_name || t("finance.itopup.mother_sim")}
                            </td>
                            <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                              {money(row.amount)}
                            </td>
                            <td className="px-2 py-1 text-xs capitalize">
                              {t(`finance.itopup.movements.${row.movement}`)}
                            </td>
                            <td className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
                              {row.notes || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                    {transfers.map((row) => (
                      <div key={row.id} className="px-4 py-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {formatDateTime(row.created_at)}
                          </p>
                          <p className="text-sm font-bold">{money(row.amount)}</p>
                        </div>
                        <p className="text-sm font-medium">
                          {row.from_employee_name || t("finance.itopup.mother_sim")} →{" "}
                          {row.to_employee_name || t("finance.itopup.mother_sim")}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 capitalize">
                          {t(`finance.itopup.movements.${row.movement}`)}
                          {row.notes ? ` • ${row.notes}` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="px-4 py-3">
                <Pagination meta={transferPagination} onPage={setTransferPage} />
              </div>
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={showEntry}
        onClose={() => setShowEntry(false)}
        title={t("finance.itopup.entry_title")}
        subtitle={t("finance.itopup.entry_desc")}
        busy={savingEntry}
        maxWidth="sm:max-w-2xl"
        footer={
          <>
            <button type="button" onClick={() => setShowEntry(false)} className={btnSecondary}>
              {t("finance.common.cancel")}
            </button>
            <button type="button" onClick={submitEntry} disabled={savingEntry} className={btnPrimary}>
              {savingEntry ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {savingEntry ? t("finance.common.saving") : t("finance.common.save")}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t("finance.itopup.holder")} required>
            <select
              value={entryForm.employee_id}
              onChange={(event) => setEntryForm({ ...entryForm, employee_id: event.target.value })}
              className={selectClass}
            >
              <option value="mother">{t("finance.itopup.mother_sim")}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employeeLabel(employee)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("finance.common.business_date")}>
            <input
              type="date"
              value={entryForm.business_date}
              max={todayISO()}
              onChange={(event) => setEntryForm({ ...entryForm, business_date: event.target.value })}
              className={`${inputClass} cursor-pointer`}
            />
          </Field>
          <Field label={t("finance.itopup.entry_type")} required error={entryErrors.entry_type}>
            <select
              value={entryForm.entry_type}
              onChange={(event) => setEntryForm({ ...entryForm, entry_type: event.target.value })}
              className={selectClass}
            >
              <option value="usage">{t("finance.common.entry_types.usage")}</option>
              <option value="return">{t("finance.common.entry_types.return")}</option>
              <option value="adjustment">{t("finance.common.entry_types.adjustment")}</option>
            </select>
          </Field>
          <Field label={t("finance.common.amount")} required error={entryErrors.amount}>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={entryForm.amount}
              onChange={(event) => setEntryForm({ ...entryForm, amount: event.target.value })}
              placeholder="0.00"
              className={inputClass}
            />
          </Field>
          <Field label={t("finance.common.reference")}>
            <input
              value={entryForm.reference}
              onChange={(event) => setEntryForm({ ...entryForm, reference: event.target.value })}
              maxLength={120}
              className={inputClass}
            />
          </Field>
          <Field label={t("finance.itopup.source")}>
            <select
              value={entryForm.report_source}
              onChange={(event) => setEntryForm({ ...entryForm, report_source: event.target.value })}
              className={selectClass}
            >
              <option value="manual">{t("finance.itopup.manual")}</option>
              <option value="dms_report">{t("finance.itopup.from_report")}</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label={t("finance.common.notes")}>
              <textarea
                value={entryForm.notes}
                onChange={(event) => setEntryForm({ ...entryForm, notes: event.target.value })}
                rows={2}
                maxLength={2000}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="md:col-span-2 text-[11px] text-gray-500 dark:text-gray-400">
            {t("finance.itopup.entry_hint")}
          </p>
        </div>
        <FieldError error={entryError || undefined} />
      </Modal>

      <Modal
        open={showTransfer}
        onClose={() => setShowTransfer(false)}
        title={t("finance.itopup.transfer_title")}
        subtitle={t("finance.itopup.transfer_desc")}
        busy={savingTransfer}
        footer={
          <>
            <button type="button" onClick={() => setShowTransfer(false)} className={btnSecondary}>
              {t("finance.common.cancel")}
            </button>
            <button
              type="button"
              onClick={submitTransfer}
              disabled={savingTransfer}
              className={btnPrimary}
            >
              {savingTransfer ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
              {savingTransfer ? t("finance.common.saving") : t("finance.itopup.transfer")}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t("finance.itopup.from")} required error={transferErrors.from}>
            <select
              value={transferForm.from}
              onChange={(event) => setTransferForm({ ...transferForm, from: event.target.value })}
              className={selectClass}
            >
              <option value="">{t("finance.common.select")}</option>
              <option value="mother">{t("finance.itopup.mother_sim")}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employeeLabel(employee)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("finance.itopup.to")} required error={transferErrors.to}>
            <select
              value={transferForm.to}
              onChange={(event) => setTransferForm({ ...transferForm, to: event.target.value })}
              className={selectClass}
            >
              <option value="">{t("finance.common.select")}</option>
              <option value="mother">{t("finance.itopup.mother_sim")}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employeeLabel(employee)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("finance.common.amount")} required error={transferErrors.amount}>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={transferForm.amount}
              onChange={(event) => setTransferForm({ ...transferForm, amount: event.target.value })}
              placeholder="0.00"
              className={inputClass}
            />
          </Field>
          <Field label={t("finance.itopup.movement")}>
            <select
              value={transferForm.movement}
              onChange={(event) => setTransferForm({ ...transferForm, movement: event.target.value })}
              className={selectClass}
            >
              <option value="morning">{t("finance.itopup.movements.morning")}</option>
              <option value="evening">{t("finance.itopup.movements.evening")}</option>
              <option value="other">{t("finance.itopup.movements.other")}</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label={t("finance.common.notes")}>
              <input
                value={transferForm.notes}
                onChange={(event) => setTransferForm({ ...transferForm, notes: event.target.value })}
                maxLength={255}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="md:col-span-2 text-[11px] text-gray-500 dark:text-gray-400">
            {t("finance.itopup.transfer_hint")}
          </p>
        </div>
        <FieldError error={transferError || undefined} />
      </Modal>

      <Modal
        open={Boolean(verifyTarget)}
        onClose={() => setVerifyTarget(null)}
        title={t("finance.itopup.verify_title")}
        subtitle={
          verifyTarget
            ? `${verifyTarget.employee_name} • ${t(`finance.common.entry_types.${verifyTarget.entry_type}`)} • ${money(verifyTarget.amount)}`
            : undefined
        }
        busy={verifying}
        footer={
          <>
            <button type="button" onClick={() => setVerifyTarget(null)} className={btnSecondary}>
              {t("finance.common.cancel")}
            </button>
            <button type="button" onClick={submitVerify} disabled={verifying} className={btnPrimary}>
              {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
              {t("finance.itopup.verify")}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("finance.itopup.verified_amount")} required error={verifyError || undefined}>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={verifyAmount}
              onChange={(event) => {
                setVerifyAmount(event.target.value);
                setVerifyError(null);
              }}
              className={inputClass}
            />
          </Field>
          <Field label={t("finance.common.notes")}>
            <textarea
              value={verifyNotes}
              onChange={(event) => setVerifyNotes(event.target.value)}
              rows={2}
              maxLength={2000}
              className={inputClass}
            />
          </Field>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("finance.itopup.verify_hint")}
          </p>
        </div>
      </Modal>
    </div>
  );
}
