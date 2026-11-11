"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileText, RefreshCw, Search } from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";

interface DocumentType {
  id: number;
  code: string;
  name: string;
  name_bn: string | null;
}

interface Template {
  id: number;
  document_type_id: number;
  scope: "global" | "house";
  name: string;
  template_mode: "PREDEFINED" | "VISUAL";
  is_default: boolean;
  is_active: boolean;
  latest_version: {
    version_number: number;
    is_published: boolean;
    published_version?: number;
  } | null;
}

interface Pagination {
  page: number;
  total_pages: number;
  total: number;
  has_next: boolean;
  has_prev: boolean;
}

function TemplateSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 20 }).map((_, index) => (
        <div
          key={index}
          className="h-[68px] rounded-xl border border-gray-100 bg-gray-100 dark:border-slate-800 dark:bg-slate-800"
        />
      ))}
    </div>
  );
}

export default function DocumentTemplatesPage() {
  const { t, language } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const selectedHouseId = selectedHouse?.id;
  const canView = hasPermission("documents.templates.view");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadTemplates = useCallback(async (pageNumber: number, keyword: string) => {
    setLoading(true);
    setLoadError(false);
    try {
      const [templateResponse, typeResponse] = await Promise.all([
        apiClient.get("v1/documents/templates", {
          params: { page: pageNumber, per_page: 20, search: keyword || undefined },
          headers: selectedHouseId ? { "X-House-ID": String(selectedHouseId) } : {},
        }),
        apiClient.get("v1/documents/types"),
      ]);
      setTemplates(templateResponse.data.data);
      setPagination(templateResponse.data.pagination);
      setTypes(typeResponse.data.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [selectedHouseId]);

  useEffect(() => {
    if (authLoading || !canView) return;
    const timer = setTimeout(() => {
      void loadTemplates(page, search);
    }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [authLoading, canView, loadTemplates, page, search]);

  if (!authLoading && !canView) return <AccessDenied />;

  const typeNames = new Map(
    types.map((type) => [type.id, language === "bn" ? type.name_bn || type.name : type.name])
  );

  const statusLabel = (template: Template) => {
    if (!template.is_active) return t("documents.inactive");
    const versionStatus = template.latest_version?.is_published
      ? t("documents.published")
      : t("documents.draft");
    return `${t("documents.active")} · ${versionStatus}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center rounded-xl bg-sky-50 p-2 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
            <FileText className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("documents.title")}
          </h1>
          <PageGuideModal pageKey="documents" />
        </div>
        <button
          type="button"
          onClick={() => void loadTemplates(page, search)}
          disabled={loading}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("documents.refresh")}
        </button>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {t("documents.description")}
        </p>
        <label className="relative block max-w-md">
          <span className="sr-only">{t("documents.search")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={t("documents.search")}
            className="w-full cursor-text rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
          />
        </label>
      </section>

      {loading ? (
        <TemplateSkeleton />
      ) : loadError ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-950/20">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            {t("documents.load_error")}
          </p>
          <button
            type="button"
            onClick={() => void loadTemplates(page, search)}
            className="mt-4 min-h-11 cursor-pointer rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
          >
            {t("documents.try_again")}
          </button>
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white py-14 text-center dark:border-slate-700 dark:bg-slate-900">
          <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-slate-600" />
          <p className="font-semibold text-gray-800 dark:text-gray-200">
            {t("documents.no_templates")}
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900 lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("documents.template")}</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("documents.type")}</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("documents.scope")}</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("documents.version")}</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("documents.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td className="px-2 py-1">
                      <Link href={`/documents/templates/${template.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">{template.name}</Link>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {template.template_mode === "VISUAL" ? t("documents.visual") : t("documents.predefined")}
                        {template.is_default ? ` · ${t("documents.default")}` : ""}
                      </p>
                    </td>
                    <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{typeNames.get(template.document_type_id) || "-"}</td>
                    <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{t(`documents.${template.scope}`)}</td>
                    <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{template.latest_version ? `v${template.latest_version.version_number}` : "-"}</td>
                    <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{statusLabel(template)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 lg:hidden">
            {templates.map((template) => (
              <article key={template.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100"><Link href={`/documents/templates/${template.id}`} className="hover:text-primary-700 hover:underline dark:hover:text-primary-300">{template.name}</Link></h2>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {template.template_mode === "VISUAL" ? t("documents.visual") : t("documents.predefined")}
                  {template.is_default ? ` · ${t("documents.default")}` : ""}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">{t("documents.type")}</dt>
                    <dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{typeNames.get(template.document_type_id) || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">{t("documents.scope")}</dt>
                    <dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{t(`documents.${template.scope}`)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">{t("documents.version")}</dt>
                    <dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{template.latest_version ? `v${template.latest_version.version_number}` : "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">{t("documents.status")}</dt>
                    <dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{statusLabel(template)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          {pagination && pagination.total_pages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("documents.page_count", { page: pagination.page, total: pagination.total_pages, count: pagination.total })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={!pagination.has_prev}
                  className="min-h-11 min-w-11 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200"
                >
                  {t("common.prev")}
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={!pagination.has_next}
                  className="min-h-11 min-w-11 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200"
                >
                  {t("common.next")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
