"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ChevronRight,
  FileImage,
  Home,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "react-hot-toast";
import PageGuideModal from "@/components/PageGuideModal";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";

interface HouseImageState {
  house_id: number;
  has_image: boolean;
}

interface HouseOption {
  id: number;
  name: string;
  code: string;
  display_name?: string;
}

const NAMESPACE = "document_letterheads";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

export default function HouseLetterheadImageManager() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const canManage = hasPermission("documents.letterheads.manage");

  const houseFromUrl = Number(searchParams.get("house_id")) || null;
  const [houseId, setHouseId] = useState<number | null>(houseFromUrl ?? selectedHouse?.id ?? null);
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [housesLoading, setHousesLoading] = useState(true);
  const [status, setStatus] = useState<HouseImageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const headers = houseId ? { "X-House-ID": String(houseId) } : {};

  const loadHouses = useCallback(async () => {
    setHousesLoading(true);
    try {
      const response = await apiClient.get<HouseOption[]>("houses/accessible");
      const list = Array.isArray(response.data) ? response.data : [];
      setHouses(list);
      setHouseId((current) => {
        if (current && list.some((house) => house.id === current)) return current;
        return houseFromUrl && list.some((house) => house.id === houseFromUrl)
          ? houseFromUrl
          : (selectedHouse?.id ?? list[0]?.id ?? null);
      });
    } catch {
      setHouses([]);
    } finally {
      setHousesLoading(false);
    }
  }, [houseFromUrl, selectedHouse?.id]);

  useEffect(() => {
    if (authLoading || !canManage) return;
    void loadHouses();
  }, [authLoading, canManage, loadHouses]);

  const loadStatus = useCallback(async () => {
    if (!houseId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await apiClient.get<{ data: HouseImageState }>(
        "v1/documents/letterheads/house-image",
        { headers: { "X-House-ID": String(houseId) } },
      );
      setStatus(response.data.data);
    } catch {
      setLoadError(true);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [houseId]);

  useEffect(() => {
    if (authLoading || !canManage || !houseId) {
      setLoading(false);
      return;
    }
    void loadStatus();
  }, [authLoading, canManage, houseId, loadStatus]);

  useEffect(() => {
    setFile(null);
    setFileError("");
    setImageUrl(null);
    setStatus(null);
    setLoadError(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [houseId]);

  const changeHouse = (ids: (string | number)[]) => {
    const next = ids.length ? Number(ids[0]) : null;
    setHouseId(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("house_id", String(next));
    else params.delete("house_id");
    router.replace(`${window.location.pathname}?${params.toString()}`);
  };

  // The stream endpoint is permission-guarded, so the image must be fetched
  // with the auth token and shown through an object URL.
  useEffect(() => {
    if (!houseId || !status?.has_image) {
      setImageUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    apiClient
      .get("v1/documents/letterheads/house-image/file", {
        headers: { "X-House-ID": String(houseId) },
        responseType: "blob",
      })
      .then((response) => {
        if (cancelled) return;
        objectUrl = window.URL.createObjectURL(new Blob([response.data], { type: "image/jpeg" }));
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setImageUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [houseId, status?.has_image, imageVersion]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    if (!chosen) {
      setFile(null);
      setFileError("");
      return;
    }
    if (!ALLOWED_TYPES.includes(chosen.type)) {
      setFile(null);
      setFileError(t(`${NAMESPACE}.invalid_type`));
      event.target.value = "";
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setFile(null);
      setFileError(t(`${NAMESPACE}.invalid_size`));
      event.target.value = "";
      return;
    }
    setFile(chosen);
    setFileError("");
  };

  const uploadImage = async () => {
    if (!houseId) {
      toast.error(t(`${NAMESPACE}.select_house`));
      return;
    }
    if (!file) {
      setFileError(t(`${NAMESPACE}.choose_file`));
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await apiClient.post("v1/documents/letterheads/house-image", formData, {
        headers: { ...headers, "Content-Type": "multipart/form-data" },
      });
      toast.success(t(`${NAMESPACE}.upload_success`));
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setImageVersion((value) => value + 1);
      await loadStatus();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t(`${NAMESPACE}.upload_error`)));
    } finally {
      setUploading(false);
    }
  };

  const deleteImage = async () => {
    if (!houseId || !status?.has_image) return;
    if (!window.confirm(t(`${NAMESPACE}.delete_confirm`))) return;
    setDeleting(true);
    try {
      await apiClient.delete("v1/documents/letterheads/house-image", { headers });
      toast.success(t(`${NAMESPACE}.delete_success`));
      setImageUrl(null);
      setImageVersion((value) => value + 1);
      await loadStatus();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t(`${NAMESPACE}.delete_error`)));
    } finally {
      setDeleting(false);
    }
  };

  if (!authLoading && !canManage) return <AccessDenied />;

  const hasImage = Boolean(status?.has_image);
  const busy = uploading || deleting;

  return (
    <main className="mx-auto min-h-screen max-w-[1200px] min-w-0 p-2 pb-8 sm:px-6 sm:pb-8 sm:pt-2">
      <header className="mb-4 border-b border-gray-200 pb-4 dark:border-slate-700">
        <nav aria-label={t(`${NAMESPACE}.breadcrumb_label`)} className="-mt-2 mb-4 text-[13px]">
          <ol className="flex flex-wrap items-center gap-1.5 text-gray-500 dark:text-gray-400">
            <li>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
              >
                <Home aria-hidden="true" className="size-4" />
                {t(`${NAMESPACE}.breadcrumb_home`)}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li>
              <Link
                href="/documents"
                className="transition-colors hover:text-gray-700 dark:hover:text-gray-200"
              >
                {t(`${NAMESPACE}.breadcrumb_documents`)}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li aria-current="page" className="font-medium text-gray-700 dark:text-gray-300">
              {t(`${NAMESPACE}.title`)}
            </li>
          </ol>
        </nav>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileImage aria-hidden="true" className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {t(`${NAMESPACE}.title`)}
          </h1>
          <PageGuideModal pageKey={NAMESPACE} />
        </div>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {t(`${NAMESPACE}.description`)}
        </p>
        {!housesLoading && houses.length > 0 && (
          <div className="mt-4 w-full max-w-sm">
            <EntitySelector
              label={t(`${NAMESPACE}.house_label`)}
              items={houses.map((house) => ({
                id: house.id,
                label: house.display_name || house.name,
                sublabel: house.code,
              }))}
              selectedIds={houseId ? [houseId] : []}
              onChange={changeHouse}
              single
              closeOnSelect
              showSelectAll={false}
              placeholder={t(`${NAMESPACE}.house_placeholder`)}
              searchPlaceholder={t(`${NAMESPACE}.house_search`)}
              emptyMessage={t(`${NAMESPACE}.house_empty`)}
              noResultsMessage={t(`${NAMESPACE}.house_no_results`)}
              selectAllLabel={t(`${NAMESPACE}.house_select_all`)}
              clearLabel={t(`${NAMESPACE}.house_clear`)}
              selectedLabel={t(`${NAMESPACE}.house_selected`)}
              disabled={busy}
            />
          </div>
        )}
      </header>

      {!houseId ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="p-6">
            <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
              {t(housesLoading ? `${NAMESPACE}.loading` : houses.length === 0 ? `${NAMESPACE}.no_houses` : `${NAMESPACE}.select_house`)}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-4">
            <div className="space-y-1.5">
              <CardTitle className="text-lg">{t(`${NAMESPACE}.card_title`)}</CardTitle>
              <CardDescription>{t(`${NAMESPACE}.card_description`)}</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadStatus()}
              disabled={loading || busy}
              className={cn("min-h-11 min-w-11", loading || busy ? "disabled:cursor-not-allowed" : "cursor-pointer")}
            >
              <RefreshCw aria-hidden="true" className={loading ? "animate-spin" : ""} />
              {t(`${NAMESPACE}.refresh`)}
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <div aria-hidden="true" className="animate-pulse space-y-5">
                <div className="h-64 w-full max-w-md rounded-xl bg-gray-100 dark:bg-slate-800" />
                <div className="h-11 w-full rounded-xl bg-gray-100 dark:bg-slate-800" />
                <div className="flex gap-2">
                  <div className="h-10 w-32 rounded-md bg-gray-100 dark:bg-slate-800" />
                  <div className="h-10 w-32 rounded-md bg-gray-100 dark:bg-slate-800" />
                </div>
              </div>
            ) : loadError ? (
              <p role="alert" className="text-sm text-destructive">
                {t(`${NAMESPACE}.load_error`)}
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
                    {t(`${NAMESPACE}.preview_label`)}
                  </p>
                  <div className="flex w-full max-w-md items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-900">
                    {hasImage && imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt={t(`${NAMESPACE}.image_label`)}
                        width={1240}
                        height={1754}
                        unoptimized
                        className="max-h-80 w-full object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                        <FileImage aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          {t(`${NAMESPACE}.no_image`)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="house-letterhead-file"
                    className="block text-sm font-bold text-gray-700 dark:text-gray-300"
                  >
                    {t(`${NAMESPACE}.image_label`)}
                  </label>
                  <input
                    ref={fileInputRef}
                    id="house-letterhead-file"
                    type="file"
                    accept={ALLOWED_TYPES.join(",")}
                    onChange={handleFileChange}
                    aria-invalid={Boolean(fileError)}
                    aria-describedby={fileError ? "house-letterhead-file-error" : "house-letterhead-file-hint"}
                    className="block min-h-11 w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary file:px-4 file:text-sm file:font-medium file:text-primary-foreground"
                  />
                  {fileError ? (
                    <p id="house-letterhead-file-error" className="text-xs text-destructive">
                      {fileError}
                    </p>
                  ) : (
                    <p id="house-letterhead-file-hint" className="text-xs text-muted-foreground">
                      {t(`${NAMESPACE}.image_hint`)}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void uploadImage()}
                    disabled={!file || busy}
                    className={cn("min-h-11", !file || busy ? "disabled:cursor-not-allowed" : "cursor-pointer")}
                  >
                    <Upload aria-hidden="true" />
                    {uploading
                      ? t(`${NAMESPACE}.uploading`)
                      : hasImage
                        ? t(`${NAMESPACE}.replace`)
                        : t(`${NAMESPACE}.upload`)}
                  </Button>
                  {hasImage && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => void deleteImage()}
                      disabled={busy}
                      className={cn("min-h-11", busy ? "disabled:cursor-not-allowed" : "cursor-pointer")}
                    >
                      <Trash2 aria-hidden="true" />
                      {deleting ? t(`${NAMESPACE}.deleting`) : t(`${NAMESPACE}.delete`)}
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
