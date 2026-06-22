"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";
import { ArrowLeft, Building2, CalendarDays, MapPin, Radio, Users, Store, Activity, Tag, Copy, Check, type LucideIcon } from "lucide-react";

interface BTSDetail {
  id: number;
  bts_code: string | null;
  site_id: string | null;
  address: string | null;
}

interface EmployeeDetail {
  id: number;
  dms_code: string | null;
  itop_number: string | null;
  name: string | null;
  pool_number?: string | null;
  assisted_retailer_code?: string | null;
}

interface RetailerDetail {
  retailer_code: string;
  name: string | null;
  itop_number: string | null;
  employee_name: string | null;
  employee_itop_number: string | null;
}

interface EventDetail {
  id: number;
  house_id: number;
  date: string;
  event_type_id: number;
  activity_id: number;
  thana: string;
  house_name: string | null;
  event_type_name: string | null;
  activity_name: string | null;
  created_at: string | null;
  bts_details: BTSDetail[];
  rso_details: EmployeeDetail[];
  bp_details: EmployeeDetail[];
  retailer_details: RetailerDetail[];
}

function DetailRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
      <div className="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-primary-600 dark:text-primary-400" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-0.5 break-words">{value || "—"}</p>
      </div>
    </div>
  );
}

function BTSListCard({
  items,
  copiedBtsId,
  onCopy,
}: {
  items: BTSDetail[];
  copiedBtsId: number | null;
  onCopy: (bts: BTSDetail) => void;
}) {
  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
      <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">BTS ({items.length})</p>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">—</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((bts) => {
            const btsCode = bts.bts_code?.trim();
            const isCopied = copiedBtsId === bts.id;

            return (
              <div
                key={bts.id}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-300"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-bold text-gray-900 dark:text-gray-100">{btsCode || "—"}</span>
                    {bts.address ? <span className="break-words text-gray-500 dark:text-gray-400">— {bts.address}</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onCopy(bts)}
                  disabled={!btsCode}
                  aria-label={btsCode ? `Copy BTS code ${btsCode}` : "No BTS code to copy"}
                  title={btsCode ? `Copy ${btsCode}` : "No BTS code to copy"}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-600 dark:hover:text-primary-300 dark:focus:ring-offset-slate-700"
                >
                  {isCopied ? <Check className="size-4 text-primary-600 dark:text-primary-300" /> : <Copy className="size-4" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RSOListCard({
  items,
  copiedRsoId,
  onCopy,
  getSublabel,
}: {
  items: EmployeeDetail[];
  copiedRsoId: number | null;
  onCopy: (rso: EmployeeDetail) => void;
  getSublabel?: (item: EmployeeDetail) => string | null;
}) {
  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
      <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">RSO ({items.length})</p>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">—</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((rso) => {
            const assistedCode = rso.assisted_retailer_code?.trim();
            const isCopied = copiedRsoId === rso.id;
            const subLabel = getSublabel ? getSublabel(rso) : (() => {
              const last3 = rso.itop_number?.slice(-3);
              return last3 ? `${rso.name || rso.dms_code} • ${last3}` : null;
            })();

            return (
              <div
                key={rso.id}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-300"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <span className="block break-words">{assistedCode || "—"}</span>
                  {subLabel && (
                    <span className="block text-[10px] text-gray-400 dark:text-gray-500">{subLabel}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onCopy(rso)}
                  disabled={!assistedCode}
                  aria-label={assistedCode ? `Copy assisted retailer code ${assistedCode}` : "No assisted retailer code to copy"}
                  title={assistedCode ? `Copy ${assistedCode}` : "No assisted retailer code to copy"}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-600 dark:hover:text-primary-300 dark:focus:ring-offset-slate-700"
                >
                  {isCopied ? <Check className="size-4 text-primary-600 dark:text-primary-300" /> : <Copy className="size-4" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RetailerListCard({
  items,
  copiedRetailerCode,
  onCopy,
}: {
  items: RetailerDetail[];
  copiedRetailerCode: string | null;
  onCopy: (retailer: RetailerDetail) => void;
}) {
  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
      <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Retailer ({items.length})</p>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">—</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((retailer) => {
            const code = retailer.retailer_code?.trim();
            const last3 = retailer.employee_itop_number?.slice(-3);
            const rsoLabel = last3 ? `${retailer.employee_name ?? ""} • ${last3}` : null;
            const isCopied = copiedRetailerCode === code;
            const displayText = [
              code,
              retailer.name,
              retailer.itop_number,
            ].filter(Boolean).join(" • ");

            return (
              <div
                key={code}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-300"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <span className="block break-words">{displayText || "—"}</span>
                  {rsoLabel && (
                    <span className="block text-[10px] text-gray-400 dark:text-gray-500">{rsoLabel}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onCopy(retailer)}
                  disabled={!code}
                  aria-label={code ? `Copy retailer code ${code}` : "No retailer code to copy"}
                  title={code ? `Copy ${code}` : "No retailer code to copy"}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-600 dark:hover:text-primary-300 dark:focus:ring-offset-slate-700"
                >
                  {isCopied ? <Check className="size-4 text-primary-600 dark:text-primary-300" /> : <Copy className="size-4" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LocationCard({
  locationText,
  copied,
  onCopy,
}: {
  locationText: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const hasLocation = locationText.length > 0;

  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Location</p>
        <button
          type="button"
          onClick={onCopy}
          disabled={!hasLocation}
          aria-label="Copy BTS locations"
          title={hasLocation ? "Copy locations" : "No location to copy"}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-primary-300 dark:focus:ring-offset-slate-800"
        >
          {copied ? <Check className="size-4 text-primary-600 dark:text-primary-300" /> : <Copy className="size-4" />}
        </button>
      </div>
      <p className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium leading-relaxed text-gray-700 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-300">
        {locationText || "—"}
      </p>
    </div>
  );
}

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const canViewZoomIn = hasPermission("zoom_in.view");
  const loadFailedMessage = t("zoom_in.messages.load_failed");

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedBtsId, setCopiedBtsId] = useState<number | null>(null);
  const [copiedRsoId, setCopiedRsoId] = useState<number | null>(null);
  const [copiedRetailerCode, setCopiedRetailerCode] = useState<string | null>(null);
  const [copiedLocation, setCopiedLocation] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (authLoading || !canViewZoomIn) return;
    const fetchEvent = async () => {
      try {
        const res = await apiClient.get<EventDetail>(`zoom-in/events/${params.id}`);
        setEvent(res.data);
      } catch {
        toast.error(loadFailedMessage);
      } finally {
        setLoading(false);
      }
    };
    fetchEvent();
  }, [authLoading, canViewZoomIn, params.id, loadFailedMessage]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const writeToClipboard = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  const handleCopyBtsCode = async (bts: BTSDetail) => {
    const btsCode = bts.bts_code?.trim();
    if (!btsCode) return;

    try {
      await writeToClipboard(btsCode);
      setCopiedBtsId(bts.id);
      setCopiedRsoId(null);
      setCopiedRetailerCode(null);
      setCopiedLocation(false);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedBtsId(null), 1600);
    } catch {
      toast.error("BTS code copy failed");
    }
  };

  const handleCopyAssistedCode = async (rso: EmployeeDetail) => {
    const assistedCode = rso.assisted_retailer_code?.trim();
    if (!assistedCode) return;

    try {
      await writeToClipboard(assistedCode);
      setCopiedBtsId(null);
      setCopiedRsoId(rso.id);
      setCopiedRetailerCode(null);
      setCopiedLocation(false);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedRsoId(null), 1600);
    } catch {
      toast.error("Assisted code copy failed");
    }
  };

  const handleCopyRetailerCode = async (retailer: RetailerDetail) => {
    const code = retailer.retailer_code?.trim();
    if (!code) return;

    try {
      await writeToClipboard(code);
      setCopiedBtsId(null);
      setCopiedRsoId(null);
      setCopiedRetailerCode(code);
      setCopiedLocation(false);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedRetailerCode(null), 1600);
    } catch {
      toast.error("Retailer code copy failed");
    }
  };

  const handleCopyLocation = async (locationText: string) => {
    if (!locationText) return;

    try {
      await writeToClipboard(locationText);
      setCopiedBtsId(null);
      setCopiedRsoId(null);
      setCopiedRetailerCode(null);
      setCopiedLocation(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedLocation(false), 1600);
    } catch {
      toast.error("Location copy failed");
    }
  };

  if (!authLoading && !canViewZoomIn) {
    return <AccessDenied />;
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-gray-200 dark:bg-slate-800 rounded-xl animate-pulse" />
          <div className="space-y-2">
            <div className="h-6 w-48 bg-gray-200 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-4 w-32 bg-gray-100 dark:bg-slate-800 rounded-md animate-pulse" />
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-6 md:p-8 space-y-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-slate-900 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Event not found</h2>
        <button onClick={() => router.push("/zoom-in")} className="mt-4 text-primary-500 hover:underline text-sm">
          &larr; Back to events
        </button>
      </div>
    );
  }

  const btsLocationText = event.bts_details
    .map((bts) => bts.address?.trim())
    .filter((address): address is string => Boolean(address))
    .join(", ");

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.create_event")} #{event.id}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{event.date}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
        <div className="p-6 md:p-8 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow icon={Building2} label={t("zoom_in.fields.house")} value={event.house_name} />
            <DetailRow icon={CalendarDays} label={t("zoom_in.fields.date")} value={event.date} />
            <DetailRow icon={Tag} label={t("zoom_in.fields.event_type")} value={event.event_type_name} />
            <DetailRow icon={Activity} label={t("zoom_in.fields.activity")} value={event.activity_name} />
            <DetailRow icon={MapPin} label={t("zoom_in.fields.thana")} value={event.thana} />
          </div>

          <hr className="border-gray-100 dark:border-slate-800" />

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-primary-500" />
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.fields.bts")}</h3>
            </div>
            <BTSListCard items={event.bts_details} copiedBtsId={copiedBtsId} onCopy={handleCopyBtsCode} />
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary-500" />
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Location</h3>
            </div>
            <LocationCard
              locationText={btsLocationText}
              copied={copiedLocation}
              onCopy={() => handleCopyLocation(btsLocationText)}
            />
          </div>

          <hr className="border-gray-100 dark:border-slate-800" />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary-500" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.fields.rso")}</h3>
              </div>
              <RSOListCard items={event.rso_details} copiedRsoId={copiedRsoId} onCopy={handleCopyAssistedCode} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary-500" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.fields.bp")}</h3>
              </div>
              <RSOListCard items={event.bp_details} copiedRsoId={copiedRsoId} onCopy={handleCopyAssistedCode} getSublabel={(item) => item.pool_number ? `${item.name || item.dms_code} • ${item.pool_number}` : null} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-primary-500" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.fields.retailer_code")}</h3>
              </div>
              <RetailerListCard items={event.retailer_details} copiedRetailerCode={copiedRetailerCode} onCopy={handleCopyRetailerCode} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
