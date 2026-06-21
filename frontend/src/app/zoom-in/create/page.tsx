"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";
import { Loader2, ArrowLeft } from "lucide-react";
import EntitySelector, { SelectorItem } from "../_components/EntitySelector";

interface House {
  id: number;
  name: string;
  code: string;
}

interface EventType {
  id: number;
  name: string;
}

interface Activity {
  id: number;
  name: string;
}

interface BTS {
  id: number;
  site_id: string;
  bts_code: string;
  address: string | null;
}

interface Employee {
  id: number;
  dms_code: string;
  itop_number: string | null;
  name: string | null;
  assisted_retailer_code: string | null;
}

interface RetailerItem {
  retailer_code: string;
  name: string;
  itop_number: string | null;
  sim_seller: string | null;
  rso_itop_last3: string | null;
  activation_count: number;
}

export default function CreateZoomInEventPage() {
  const router = useRouter();
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [houses, setHouses] = useState<House[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [thanas, setThanas] = useState<string[]>([]);
  const [btsList, setBtsList] = useState<BTS[]>([]);
  const [rsos, setRsos] = useState<Employee[]>([]);
  const [bps, setBps] = useState<Employee[]>([]);
  const [retailers, setRetailers] = useState<RetailerItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [houseId, setHouseId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [eventTypeId, setEventTypeId] = useState("");
  const [activityId, setActivityId] = useState("");
  const [thana, setThana] = useState("");
  const [selectedBtsIds, setSelectedBtsIds] = useState<number[]>([]);
  const [selectedRsoIds, setSelectedRsoIds] = useState<number[]>([]);
  const [selectedBpIds, setSelectedBpIds] = useState<number[]>([]);
  const [selectedRetailers, setSelectedRetailers] = useState<string[]>([]);
  const [showOtherRetailer, setShowOtherRetailer] = useState(false);
  const [otherRetailerCode, setOtherRetailerCode] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (authLoading || !hasPermission("zoom_in.create")) return;
    const fetchInitial = async () => {
      setLoading(true);
      try {
        const [housesRes, eventTypesRes, activitiesRes] = await Promise.all([
          apiClient.get("houses/accessible"),
          apiClient.get("zoom-in/event-types"),
          apiClient.get("zoom-in/activities"),
        ]);
        setHouses(housesRes.data);
        setEventTypes(eventTypesRes.data);
        setActivities(activitiesRes.data);
      } catch {
        toast.error(t("common.error"));
      } finally {
        setLoading(false);
      }
    };
    fetchInitial();
  }, [authLoading]);

  useEffect(() => {
    if (!houseId) return;
    const fetchThanas = async () => {
      try {
        const res = await apiClient.get("zoom-in/thanas", { params: { house_id: houseId } });
        setThanas(res.data);
        setThana("");
        setBtsList([]);
        setSelectedBtsIds([]);
      } catch { /* silent */ }
    };
    fetchThanas();
  }, [houseId]);

  useEffect(() => {
    if (!houseId) return;
    const fetchEmployees = async () => {
      try {
        const [rsosRes, bpsRes] = await Promise.all([
          apiClient.get(`zoom-in/rsos-by-house/${houseId}`),
          apiClient.get(`zoom-in/bps-by-house/${houseId}`),
        ]);
        setRsos(rsosRes.data);
        setBps(bpsRes.data);
      } catch { /* silent */ }
    };
    fetchEmployees();
  }, [houseId]);

  useEffect(() => {
    if (!thana) {
      setBtsList([]);
      setSelectedBtsIds([]);
      return;
    }
    const fetchBts = async () => {
      try {
        const res = await apiClient.get(`zoom-in/bts-by-thana/${encodeURIComponent(thana)}`, {
          params: { house_id: houseId || undefined },
        });
        setBtsList(res.data);
        setSelectedBtsIds([]);
      } catch { /* silent */ }
    };
    fetchBts();
  }, [thana]);

  useEffect(() => {
    if (!houseId) return;
    const fetchRetailers = async () => {
      try {
        const res = await apiClient.get("zoom-in/retailers-by-rso", {
          params: { house_id: houseId },
        });
        setRetailers(res.data);
      } catch { /* silent */ }
    };
    fetchRetailers();
  }, [houseId]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!houseId) errs.house = t("zoom_in.validation.house_required");
    if (!date) errs.date = t("zoom_in.validation.date_required");
    if (!eventTypeId) errs.event_type = t("zoom_in.validation.event_type_required");
    if (!activityId) errs.activity = t("zoom_in.validation.activity_required");
    if (!thana) errs.thana = t("zoom_in.validation.thana_required");
    if (selectedBtsIds.length === 0) errs.bts = t("zoom_in.validation.bts_required");
    if (selectedRsoIds.length === 0) errs.rso = t("zoom_in.validation.rso_required");
    if (selectedBpIds.length === 0) errs.bp = t("zoom_in.validation.bp_required");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    const finalRetailers = showOtherRetailer && otherRetailerCode.trim()
      ? [...selectedRetailers, otherRetailerCode.trim()]
      : selectedRetailers;
    try {
      await apiClient.post("zoom-in/events", {
        house_id: Number(houseId),
        date,
        event_type_id: Number(eventTypeId),
        activity_id: Number(activityId),
        thana,
        bts_ids: selectedBtsIds,
        rso_ids: selectedRsoIds,
        bp_ids: selectedBpIds,
        retailer_codes: finalRetailers,
      });
      toast.success(t("zoom_in.messages.create_success"));
      router.push("/zoom-in");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || err.message || t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!authLoading && !hasPermission("zoom_in.create")) {
    return <AccessDenied />;
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="h-8 w-48 bg-gray-200 dark:bg-slate-800 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-slate-900 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.create_event")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("zoom_in.description")}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-6 md:p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("zoom_in.fields.house")} <span className="text-red-500">*</span>
            </label>
            <select
              value={houseId}
              onChange={(e) => setHouseId(e.target.value)}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
            >
              <option value="">{t("zoom_in.fields.select_house")}</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
              ))}
            </select>
            {errors.house && <p className="text-xs text-red-500 mt-1">{errors.house}</p>}
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("zoom_in.fields.date")} <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
            />
            {errors.date && <p className="text-xs text-red-500 mt-1">{errors.date}</p>}
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("zoom_in.fields.event_type")} <span className="text-red-500">*</span>
            </label>
            <select
              value={eventTypeId}
              onChange={(e) => setEventTypeId(e.target.value)}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
            >
              <option value="">{t("zoom_in.fields.select_event_type")}</option>
              {eventTypes.map((et) => (
                <option key={et.id} value={et.id}>{et.name}</option>
              ))}
            </select>
            {errors.event_type && <p className="text-xs text-red-500 mt-1">{errors.event_type}</p>}
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("zoom_in.fields.activity")} <span className="text-red-500">*</span>
            </label>
            <select
              value={activityId}
              onChange={(e) => setActivityId(e.target.value)}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
            >
              <option value="">{t("zoom_in.fields.select_activity")}</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {errors.activity && <p className="text-xs text-red-500 mt-1">{errors.activity}</p>}
          </div>
        </div>

        <hr className="border-gray-100 dark:border-slate-800" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("zoom_in.fields.thana")} <span className="text-red-500">*</span>
            </label>
            <select
              value={thana}
              onChange={(e) => setThana(e.target.value)}
              disabled={!houseId || thanas.length === 0}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 dark:text-gray-100"
            >
              <option value="">{t("zoom_in.fields.select_thana")}</option>
              {thanas.map((th) => (
                <option key={th} value={th}>{th}</option>
              ))}
            </select>
            {errors.thana && <p className="text-xs text-red-500 mt-1">{errors.thana}</p>}
          </div>

          <div>
            <EntitySelector
              label={t("zoom_in.fields.bts")}
              items={btsList.map((b): SelectorItem => ({
                id: b.id,
                label: `${b.site_id} (${b.bts_code})`,
                sublabel: b.address || undefined,
              }))}
              selectedIds={selectedBtsIds}
              onChange={(ids) => setSelectedBtsIds(ids as number[])}
              placeholder={t("zoom_in.fields.select_bts")}
              searchPlaceholder={t("zoom_in.fields.search_bts")}
              emptyMessage={t("zoom_in.fields.select_thana")}
              noResultsMessage="No BTS found"
              error={errors.bts}
              required
            />
          </div>
        </div>

        <hr className="border-gray-100 dark:border-slate-800" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <EntitySelector
              label={t("zoom_in.fields.rso")}
              items={rsos.map((r): SelectorItem => ({
                id: r.id,
                label: r.dms_code,
                sublabel: [r.name, r.itop_number, r.assisted_retailer_code].filter(Boolean).join(" · ") || undefined,
              }))}
              selectedIds={selectedRsoIds}
              onChange={(ids) => setSelectedRsoIds(ids as number[])}
              placeholder={t("zoom_in.fields.select_rso")}
              searchPlaceholder={t("zoom_in.fields.search_rso")}
              emptyMessage={t("zoom_in.fields.select_house")}
              noResultsMessage="No RSO found"
              error={errors.rso}
              required
            />
          </div>

          <div>
            <EntitySelector
              label={t("zoom_in.fields.bp")}
              items={bps.map((b): SelectorItem => ({
                id: b.id,
                label: b.dms_code,
                sublabel: [b.itop_number, b.assisted_retailer_code].filter(Boolean).join(" · ") || undefined,
              }))}
              selectedIds={selectedBpIds}
              onChange={(ids) => setSelectedBpIds(ids as number[])}
              placeholder={t("zoom_in.fields.select_bp")}
              searchPlaceholder={t("zoom_in.fields.search_bp")}
              emptyMessage={t("zoom_in.fields.select_house")}
              noResultsMessage="No BP found"
              error={errors.bp}
              required
            />
          </div>

          <div>
            <EntitySelector
              label={t("zoom_in.fields.retailer_code")}
              items={retailers.map((r): SelectorItem => ({
                id: r.retailer_code,
                label: r.name,
                sublabel: [r.itop_number, r.retailer_code, r.rso_itop_last3].filter(Boolean).join(" · ") || undefined,
              }))}
              selectedIds={selectedRetailers}
              onChange={(ids) => setSelectedRetailers(ids as string[])}
              placeholder={t("zoom_in.fields.select_retailer")}
              searchPlaceholder={t("zoom_in.fields.search_retailer")}
              emptyMessage={t("zoom_in.fields.select_rso")}
              noResultsMessage="No retailer found"
                  error={errors.retailer}
                />
            <label className="flex items-center gap-2 mt-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showOtherRetailer}
                onChange={(e) => setShowOtherRetailer(e.target.checked)}
                className="rounded border-gray-300 dark:border-slate-700"
              />
              {t("zoom_in.fields.select_other")}
            </label>
            {showOtherRetailer && (
              <input
                type="text"
                value={otherRetailerCode}
                onChange={(e) => setOtherRetailerCode(e.target.value)}
                placeholder="Enter retailer code"
                className="w-full mt-2 px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-bold hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("zoom_in.create_event")}
          </button>
        </div>
      </form>
    </div>
  );
}
