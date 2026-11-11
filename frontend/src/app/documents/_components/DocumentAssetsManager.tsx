"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, FileImage, PenTool, Plus, RefreshCw, Trash2 } from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";

type AssetKind = "letterheads" | "signatories";
type Scope = "house" | "global";

interface DocumentAsset {
  id: number;
  house_id: number | null;
  scope: Scope;
  name: string;
  organization_name?: string | null;
  subtitle?: string | null;
  address?: string | null;
  phone_numbers?: string[];
  email?: string | null;
  footer_text?: string | null;
  designation?: string;
  phone?: string | null;
  has_logo?: boolean;
  has_signature?: boolean;
  is_default: boolean;
  is_active: boolean;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null) return fallback;
  const response = "response" in error ? error.response : undefined;
  if (typeof response !== "object" || response === null || !("data" in response)) return fallback;
  const data = response.data;
  if (typeof data !== "object" || data === null || !("detail" in data)) return fallback;
  const detail = data.detail;
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail !== null && "message" in detail && typeof detail.message === "string") {
    return detail.message;
  }
  return fallback;
}

const fieldClass =
  "min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100";

export default function DocumentAssetsManager({ kind }: { kind: AssetKind }) {
  const namespace = kind === "letterheads" ? "document_letterheads" : "document_signatories";
  const endpoint = `v1/documents/${kind}`;
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse, user } = useAuth();
  const selectedHouseId = selectedHouse?.id;
  const permission = kind === "letterheads" ? "documents.letterheads.manage" : "documents.signatories.manage";
  const canManage = hasPermission(permission);
  const isSuperAdmin = Boolean(user?.roles?.some((role) => {
    const normalized = role.name.toLowerCase();
    return normalized === "super_admin" || normalized === "super admin";
  }));
  const [assets, setAssets] = useState<DocumentAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>(selectedHouseId ? "house" : "global");
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState({
    name: "",
    organization_name: "",
    subtitle: "",
    address: "",
    phone_numbers: "",
    email: "",
    footer_text: "",
    designation: "",
    phone: "",
    is_default: false,
    is_active: true,
  });

  const headers = useMemo(
    () => selectedHouseId ? { "X-House-ID": String(selectedHouseId) } : {},
    [selectedHouseId],
  );

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await apiClient.get(endpoint, { headers });
      setAssets(response.data.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [endpoint, headers]);

  useEffect(() => {
    if (authLoading || !canManage) return;
    void loadAssets();
  }, [authLoading, canManage, loadAssets]);

  useEffect(() => {
    setScope(selectedHouseId ? "house" : isSuperAdmin ? "global" : "house");
    setEditingId(null);
    setFile(null);
    setFields({
      name: "",
      organization_name: "",
      subtitle: "",
      address: "",
      phone_numbers: "",
      email: "",
      footer_text: "",
      designation: "",
      phone: "",
      is_default: false,
      is_active: true,
    });
  }, [selectedHouseId, isSuperAdmin]);

  const editAsset = (asset: DocumentAsset) => {
    setEditingId(asset.id);
    setScope(asset.scope);
    setFile(null);
    setNotice("");
    setErrorMessage("");
    setFields({
      name: asset.name,
      organization_name: asset.organization_name || "",
      subtitle: asset.subtitle || "",
      address: asset.address || "",
      phone_numbers: (asset.phone_numbers || []).join(", "),
      email: asset.email || "",
      footer_text: asset.footer_text || "",
      designation: asset.designation || "",
      phone: asset.phone || "",
      is_default: asset.is_default,
      is_active: asset.is_active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => {
    setEditingId(null);
    setScope(selectedHouseId ? "house" : isSuperAdmin ? "global" : "house");
    setFile(null);
    setFields({
      name: "",
      organization_name: "",
      subtitle: "",
      address: "",
      phone_numbers: "",
      email: "",
      footer_text: "",
      designation: "",
      phone: "",
      is_default: false,
      is_active: true,
    });
  };

  const saveAsset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    setErrorMessage("");
    const payload = kind === "letterheads"
      ? {
          scope,
          name: fields.name.trim(),
          organization_name: fields.organization_name.trim(),
          subtitle: fields.subtitle.trim() || null,
          address: fields.address.trim() || null,
          phone_numbers: fields.phone_numbers.split(",").map((phone) => phone.trim()).filter(Boolean),
          email: fields.email.trim() || null,
          footer_text: fields.footer_text.trim() || null,
          is_default: fields.is_default,
          is_active: fields.is_active,
        }
      : {
          scope,
          name: fields.name.trim(),
          designation: fields.designation.trim(),
          phone: fields.phone.trim() || null,
          is_default: fields.is_default,
          is_active: fields.is_active,
        };
    try {
      const response = editingId
        ? await apiClient.patch(`${endpoint}/${editingId}`, payload, { headers })
        : await apiClient.post(endpoint, payload, { headers });
      const savedId = response.data.data.id as number;
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        const assetName = kind === "letterheads" ? "logo" : "signature";
        await apiClient.post(`${endpoint}/${savedId}/${assetName}`, formData, {
          headers: { ...headers, "Content-Type": "multipart/form-data" },
        });
      }
      setNotice(t(`${namespace}.save_success`));
      resetForm();
      await loadAssets();
    } catch (error: unknown) {
      const fallback = file
        ? t(`${namespace}.upload_error`)
        : t(`${namespace}.save_error`);
      setErrorMessage(getErrorMessage(error, fallback));
      await loadAssets();
    } finally {
      setSaving(false);
    }
  };

  const deleteAsset = async (asset: DocumentAsset) => {
    if (!window.confirm(t(`${namespace}.delete_confirm`))) return;
    setNotice("");
    setErrorMessage("");
    try {
      await apiClient.delete(`${endpoint}/${asset.id}`, { headers });
      if (editingId === asset.id) resetForm();
      setNotice(t(`${namespace}.delete_success`));
      await loadAssets();
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, t(`${namespace}.delete_error`)));
    }
  };

  if (!authLoading && !canManage) return <AccessDenied />;

  const title = t(`${namespace}.title`);
  const canCreate = scope === "global" ? isSuperAdmin : Boolean(selectedHouseId);
  const visibleAssets = assets;
  const imageLabel = kind === "letterheads" ? t(`${namespace}.logo`) : t(`${namespace}.signature`);
  const hasImageLabel = kind === "letterheads" ? t(`${namespace}.has_logo`) : t(`${namespace}.has_signature`);
  const noImageLabel = kind === "letterheads" ? t(`${namespace}.no_logo`) : t(`${namespace}.no_signature`);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
            {kind === "letterheads" ? <Building2 className="h-5 w-5" /> : <PenTool className="h-5 w-5" />}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
          <PageGuideModal pageKey={namespace} />
        </div>
        <button
          type="button"
          onClick={() => void loadAssets()}
          disabled={loading}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t(`${namespace}.refresh`)}
        </button>
      </header>

      <p className="text-sm text-gray-500 dark:text-gray-400">{t(`${namespace}.description`)}</p>

      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</p>}
      {errorMessage && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{errorMessage}</p>}

      <form onSubmit={saveAsset} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingId ? t(`${namespace}.save`) : t(`${namespace}.create`)}
          </h2>
          <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <span>{t(`${namespace}.scope`)}</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as Scope)}
              disabled={Boolean(editingId)}
              className={`${fieldClass} w-auto cursor-pointer disabled:cursor-not-allowed`}
            >
              <option value="house">{t(`${namespace}.house`)}</option>
              {isSuperAdmin && <option value="global">{t(`${namespace}.global`)}</option>}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
            {t(`${namespace}.name`)}
            <input required maxLength={200} value={fields.name} onChange={(event) => setFields({ ...fields, name: event.target.value })} className={fieldClass} />
          </label>
          {kind === "letterheads" ? (
            <>
              <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t(`${namespace}.organization_name`)}
                <input required maxLength={200} value={fields.organization_name} onChange={(event) => setFields({ ...fields, organization_name: event.target.value })} className={fieldClass} />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t(`${namespace}.subtitle`)}
                <input maxLength={200} value={fields.subtitle} onChange={(event) => setFields({ ...fields, subtitle: event.target.value })} className={fieldClass} />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t(`${namespace}.email`)}
                <input type="email" maxLength={255} value={fields.email} onChange={(event) => setFields({ ...fields, email: event.target.value })} className={fieldClass} />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 md:col-span-2">
                {t(`${namespace}.address`)}
                <textarea maxLength={2000} rows={2} value={fields.address} onChange={(event) => setFields({ ...fields, address: event.target.value })} className={fieldClass} />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t(`${namespace}.phone_numbers`)}
                <input maxLength={320} value={fields.phone_numbers} onChange={(event) => setFields({ ...fields, phone_numbers: event.target.value })} className={fieldClass} />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t(`${namespace}.footer_text`)}
                <input maxLength={2000} value={fields.footer_text} onChange={(event) => setFields({ ...fields, footer_text: event.target.value })} className={fieldClass} />
              </label>
            </>
          ) : (
            <>
              <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t(`${namespace}.designation`)}
                <input required maxLength={150} value={fields.designation} onChange={(event) => setFields({ ...fields, designation: event.target.value })} className={fieldClass} />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t(`${namespace}.phone`)}
                <input type="tel" maxLength={30} value={fields.phone} onChange={(event) => setFields({ ...fields, phone: event.target.value })} className={fieldClass} />
              </label>
            </>
          )}
          <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
            {imageLabel}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              className={`${fieldClass} cursor-pointer file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-sky-700`}
            />
            <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">JPG, PNG, WEBP · 5 MB max</span>
          </label>
        </div>

        <div className="flex flex-wrap gap-5">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={fields.is_default} onChange={(event) => setFields({ ...fields, is_default: event.target.checked })} className="h-4 w-4 cursor-pointer rounded border-gray-300 text-primary-600" />
            {t(`${namespace}.is_default`)}
          </label>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={fields.is_active} onChange={(event) => setFields({ ...fields, is_active: event.target.checked })} className="h-4 w-4 cursor-pointer rounded border-gray-300 text-primary-600" />
            {t(`${namespace}.is_active`)}
          </label>
        </div>
        {!canCreate && <p className="text-sm text-amber-700 dark:text-amber-300">{t(`${namespace}.select_house`)}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving || !canCreate} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
            <Plus className="h-4 w-4" />
            {saving ? t(`${namespace}.saving`) : t(`${namespace}.save`)}
          </button>
          {editingId !== null && (
            <button type="button" onClick={resetForm} className="min-h-11 cursor-pointer rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 dark:border-slate-700 dark:text-gray-200">
              {t(`${namespace}.cancel`)}
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 animate-pulse md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-36 rounded-2xl bg-gray-100 dark:bg-slate-800" />)}
        </div>
      ) : loadError ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-950/20">
          <p className="text-sm text-red-700 dark:text-red-300">{t(`${namespace}.load_error`)}</p>
          <button type="button" onClick={() => void loadAssets()} className="mt-3 min-h-11 cursor-pointer rounded-xl bg-red-600 px-4 text-sm font-semibold text-white">{t(`${namespace}.refresh`)}</button>
        </div>
      ) : visibleAssets.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white py-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <FileImage className="mx-auto mb-3 h-9 w-9 text-gray-300 dark:text-slate-600" />
          <p className="text-sm text-gray-600 dark:text-gray-300">{t(`${namespace}.empty`)}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visibleAssets.map((asset) => {
            const globalReadOnly = asset.scope === "global" && !isSuperAdmin;
            const hasImage = kind === "letterheads" ? asset.has_logo : asset.has_signature;
            return (
              <article key={asset.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-gray-900 dark:text-gray-100">{asset.name}</h2>
                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      {t(`${namespace}.${asset.scope}`)} · {asset.is_active ? t(`${namespace}.is_active`) : t("documents.inactive")}
                      {asset.is_default ? ` · ${t("documents.default")}` : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${hasImage ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-300"}`}>
                    {hasImage ? hasImageLabel : noImageLabel}
                  </span>
                </div>
                <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                  <p className="font-medium">{kind === "letterheads" ? asset.organization_name : asset.designation}</p>
                  {kind === "letterheads" && asset.address && <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{asset.address}</p>}
                  {kind === "signatories" && asset.phone && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{asset.phone}</p>}
                </div>
                <div className="mt-4 flex gap-2">
                  {!globalReadOnly && (
                    <>
                      <button type="button" onClick={() => editAsset(asset)} className="min-h-11 cursor-pointer rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800">
                        {t(`${namespace}.edit`)}
                      </button>
                      <button type="button" onClick={() => void deleteAsset(asset)} aria-label={`${t(`${namespace}.delete`)} ${asset.name}`} className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {globalReadOnly && <span className="text-xs text-gray-500 dark:text-gray-400">{t(`${namespace}.global`)}</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
