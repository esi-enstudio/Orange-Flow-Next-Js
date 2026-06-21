"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";
import { ArrowLeft, Building2, CalendarDays, MapPin, Radio, Users, Store, Activity, Tag } from "lucide-react";

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
}

interface RetailerDetail {
  retailer_code: string;
  name: string | null;
  itop_number: string | null;
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

export default function EventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !hasPermission("zoom_in.view")) return;
    const fetchEvent = async () => {
      try {
        const res = await apiClient.get<EventDetail>(`zoom-in/events/${params.id}`);
        setEvent(res.data);
      } catch {
        toast.error(t("zoom_in.messages.load_failed"));
      } finally {
        setLoading(false);
      }
    };
    fetchEvent();
  }, [authLoading]);

  if (!authLoading && !hasPermission("zoom_in.view")) {
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

  const DetailRow = ({ icon: Icon, label, value }: { icon: any; label: string; value: string | null }) => (
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

  const ListCard = ({ title, items, renderItem }: { title: string; items: any[]; renderItem: (item: any) => string }) => (
    <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
      <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{title} ({items.length})</p>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">—</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <span key={i} className="inline-flex px-2.5 py-1 bg-white dark:bg-slate-700 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-slate-600">
              {renderItem(item)}
            </span>
          ))}
        </div>
      )}
    </div>
  );

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
            <ListCard
              title="BTS"
              items={event.bts_details}
              renderItem={(b: BTSDetail) => `${b.bts_code || ""} ${b.address ? `— ${b.address}` : ""}`}
            />
          </div>

          <hr className="border-gray-100 dark:border-slate-800" />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary-500" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.fields.rso")}</h3>
              </div>
              <ListCard
                title="RSO"
                items={event.rso_details}
                renderItem={(r: EmployeeDetail) => `${r.name || r.dms_code || ""}${r.itop_number ? ` (${r.itop_number})` : ""}`}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary-500" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.fields.bp")}</h3>
              </div>
              <ListCard
                title="BP"
                items={event.bp_details}
                renderItem={(b: EmployeeDetail) => `${b.name || b.dms_code || ""}${b.pool_number ? ` (Pool: ${b.pool_number})` : ""}`}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-primary-500" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.fields.retailer_code")}</h3>
              </div>
              <ListCard
                title="Retailer"
                items={event.retailer_details}
                renderItem={(r: RetailerDetail) => `${r.name || r.retailer_code}${r.itop_number ? ` (${r.itop_number})` : ""}`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
