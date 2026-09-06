"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Upload,
  Loader2,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Tag,
  Info,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { useLanguage } from "@/i18n/useLanguage";
import { houseHeaders, type ImportPreview, type ImportPreviewRow } from "../types";

export default function ImportPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [result, setResult] = useState<{ assigned: number; created_markings: number; skipped: number; errors: string[] } | null>(null);
  const [showErrors, setShowErrors] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("retailer_markings.import")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const handleFile = async (file: File) => {
    setUploading(true);
    setPreview(null);
    setResult(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await apiClient.post("retailer-markings/import/preview", formData, {
        headers: { ...houseHeaders(selectedHouse), "Content-Type": "multipart/form-data" },
      });
      setPreview(res.data);
      setShowErrors(true);
      toast.success(t("retailer_marking.toast_preview_ready"));
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("retailer_marking.toast_upload_failed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file);
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setConfirming(true);
    try {
      const res = await apiClient.post("retailer-markings/import/confirm", {
        batch_reference: preview.batch_reference,
        remarks: remarks.trim() || null,
      });
      setResult(res.data);
      setPreview(null);
      toast.success(t("retailer_marking.toast_imported", { count: res.data.assigned }));
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("retailer_marking.toast_import_failed"));
    } finally {
      setConfirming(false);
    }
  };

  const invalidRows = preview?.errors || [];

  if (authLoading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  if (!hasPermission("retailer_markings.import")) return <AccessDenied />;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {t("retailer_marking.import_title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("retailer_marking.import_description")}</p>
        </div>
        <PageGuideModal pageKey="retailer_marking" />
      </div>

      <div className="flex items-start gap-3 px-4 py-3 rounded-2xl border border-blue-100 dark:border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5">
        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
          <p className="font-semibold">{t("retailer_marking.required_columns")}</p>
          <p className="text-xs">
            {t("retailer_marking.columns_hint")}: <span className="font-mono">Retailer Number</span>,{" "}
            <span className="font-mono">Retailer Name</span> (optional), <span className="font-mono">Marking</span>
          </p>
        </div>
      </div>

      {result ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("retailer_marking.import_complete")}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6 max-w-md mx-auto">
              <ResultStat label={t("retailer_marking.result_assigned")} value={result.assigned} tone="green" />
              <ResultStat label={t("retailer_marking.result_created_markings")} value={result.created_markings} tone="blue" />
              <ResultStat label={t("retailer_marking.result_skipped")} value={result.skipped} tone="gray" />
            </div>
            {result.errors.length > 0 && (
              <div className="mt-6 text-left bg-red-50/50 dark:bg-red-500/5 rounded-xl p-4 border border-red-100 dark:border-red-500/20">
                <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-2">{t("retailer_marking.result_errors")}</p>
                <ul className="space-y-1">
                  {result.errors.slice(0, 8).map((e, i) => (
                    <li key={i} className="text-xs text-red-600 dark:text-red-400">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => {
                  setResult(null);
                  setPreview(null);
                  setRemarks("");
                }}
                className="px-6 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors"
              >
                {t("retailer_marking.import_another")}
              </button>
            </div>
          </div>
        </div>
      ) : preview ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryCard
              icon={<FileSpreadsheet className="w-5 h-5 text-white" />}
              tone="bg-primary-600"
              label={t("retailer_marking.total_rows")}
              value={preview.total}
            />
            <SummaryCard
              icon={<CheckCircle2 className="w-5 h-5 text-white" />}
              tone="bg-emerald-500"
              label={t("retailer_marking.valid_rows")}
              value={preview.valid_count}
            />
            <SummaryCard
              icon={<XCircle className="w-5 h-5 text-white" />}
              tone="bg-rose-500"
              label={t("retailer_marking.invalid_rows")}
              value={preview.invalid_count}
            />
          </div>

          {preview.new_markings.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-3">
                <Tag className="w-4 h-4 text-primary-600" /> {t("retailer_marking.new_markings_will_create")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {preview.new_markings.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 text-xs font-semibold border border-primary-100 dark:border-primary-500/20"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}

          {invalidRows.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-red-100 dark:border-red-500/20 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowErrors((s) => !s)}
                className="w-full flex items-center justify-between px-5 py-4"
              >
                <h3 className="text-sm font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> {t("retailer_marking.invalid_rows_details", { count: invalidRows.length })}
                </h3>
                <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", showErrors && "rotate-180")} />
              </button>
              {showErrors && (
                <div className="border-t border-gray-50 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800 max-h-[320px] overflow-y-auto">
                  {invalidRows.map((r: ImportPreviewRow) => (
                    <div key={r.line} className="flex items-center gap-3 px-5 py-3">
                      <span className="text-xs font-mono text-gray-400 w-10 shrink-0">#{r.line}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                          {r.retailer_number || "—"} · {r.marking_name || "—"}
                        </p>
                        <p className="text-[11px] text-red-500">{r.error}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                {t("retailer_marking.remarks_label")}
              </label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={t("retailer_marking.remarks_placeholder")}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  setPreview(null);
                  setRemarks("");
                }}
                disabled={confirming}
                className="flex-1 py-3 rounded-xl text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {t("retailer_marking.back_to_upload")}
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirming || preview.valid_count === 0}
                className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-bold hover:bg-primary-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary-100 dark:shadow-none"
              >
                {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {t("retailer_marking.confirm_import_btn")}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-gray-200 dark:border-slate-700 hover:border-primary-400 dark:hover:border-primary-500 transition-colors p-12 text-center cursor-pointer shadow-sm"
        >
          <input type="file" ref={fileInputRef} onChange={onFileChange} className="hidden" accept=".xlsx,.xls" />
          {uploading ? (
            <Loader2 className="w-10 h-10 animate-spin text-primary-500 mx-auto" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center mx-auto mb-4">
              <Upload className="w-8 h-8 text-primary-600 dark:text-primary-400" />
            </div>
          )}
          <p className="font-bold text-gray-900 dark:text-gray-100">{t("retailer_marking.upload_area_title")}</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{t("retailer_marking.upload_area_hint")}</p>
          <span className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 rounded-xl text-sm font-semibold">
            <FileSpreadsheet className="w-4 h-4" /> .xlsx / .xls
          </span>
        </div>
      )}

      {/* Desktop preview table */}
      {preview && preview.rows.length > 0 && (
        <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 dark:border-slate-800">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("retailer_marking.preview_rows")}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[560px]">
              <thead>
                <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                  <th className="px-5 py-3">{t("retailer_marking.preview_line")}</th>
                  <th className="px-5 py-3">{t("retailer_marking.table_retailer")}</th>
                  <th className="px-5 py-3">{t("retailer_marking.marking_col")}</th>
                  <th className="px-5 py-3">{t("retailer_marking.table_status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                {preview.rows.map((r) => (
                  <tr key={r.line} className={cn(!r.valid && "bg-red-50/40 dark:bg-red-500/5")}>
                    <td className="px-2 py-1">
                      <span className="text-xs font-mono text-gray-400">#{r.line}</span>
                    </td>
                    <td className="px-2 py-1">
                      <div className="py-2">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{r.retailer_name || "—"}</p>
                        <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{r.retailer_number}</p>
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <span className="text-xs text-gray-600 dark:text-gray-300">{r.marking_name}</span>
                    </td>
                    <td className="px-2 py-1">
                      {r.valid ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {t("retailer_marking.valid")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-500 uppercase tracking-wider">
                          <XCircle className="w-3.5 h-3.5" /> {r.error || t("retailer_marking.invalid")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mobile preview accordion */}
      {preview && preview.rows.length > 0 && (
        <div className="lg:hidden bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 dark:border-slate-800">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("retailer_marking.preview_rows")}</h3>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {preview.rows.map((r) => (
              <div key={r.line} className={cn(!r.valid && "bg-red-50/40 dark:bg-red-500/5")}>
                <button
                  onClick={() => setExpandedId((prev) => (prev === r.line ? null : r.line))}
                  className="w-full flex items-center gap-3 px-5 py-3.5 text-left"
                >
                  <span className="text-xs font-mono text-gray-400 w-10 shrink-0">#{r.line}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                      {r.retailer_name || r.retailer_number || "—"}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {r.retailer_number} · {r.marking_name}
                    </p>
                  </div>
                  {r.valid ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                </button>
                {expandedId === r.line && !r.valid && (
                  <div className="px-12 pb-3">
                    <p className="text-[11px] text-red-500">{r.error}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5 flex items-center gap-4">
      <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", tone)}>{icon}</div>
      <div>
        <p className="text-2xl font-black text-gray-900 dark:text-gray-100">{value}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{label}</p>
      </div>
    </div>
  );
}

function ResultStat({ label, value, tone }: { label: string; value: number; tone: "green" | "blue" | "gray" }) {
  const toneClass = {
    green: "text-green-600 dark:text-green-400",
    blue: "text-primary-600 dark:text-primary-400",
    gray: "text-gray-500 dark:text-gray-400",
  }[tone];
  return (
    <div className="border border-gray-100 dark:border-slate-800 rounded-xl p-3">
      <p className={cn("text-2xl font-black", toneClass)}>{value}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}