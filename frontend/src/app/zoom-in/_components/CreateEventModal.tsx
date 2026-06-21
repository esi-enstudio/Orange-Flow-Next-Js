"use client";

import { useEffect, useState, useRef } from "react";
import apiClient from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { Loader2, X, Pencil } from "lucide-react";
import EntitySelector, { SelectorItem } from "./EntitySelector";

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
  pool_number: string | null;
  name: string | null;
  employee_id: string | null;
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

interface CreateEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editEventId?: number | null;
}

export default function CreateEventModal({ isOpen, onClose, onSuccess, editEventId }: CreateEventModalProps) {
  const { t } = useLanguage();
  const isEditing = !!editEventId;
  const suppressEffects = useRef(false);

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

  const resetForm = () => {
    setErrors({});
    setHouseId("");
    setDate(new Date().toISOString().split("T")[0]);
    setEventTypeId("");
    setActivityId("");
    setThana("");
    setSelectedBtsIds([]);
    setSelectedRsoIds([]);
    setSelectedBpIds([]);
    setSelectedRetailers([]);
    setShowOtherRetailer(false);
    setOtherRetailerCode("");
    setThanas([]);
    setBtsList([]);
    setRsos([]);
    setBps([]);
    setRetailers([]);
  };

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    resetForm();

    if (editEventId) {
      loadEditData();
    } else {
      loadCreateData();
    }
  }, [isOpen, editEventId]);

  const loadCreateData = async () => {
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

  const loadEditData = async () => {
    suppressEffects.current = true;
    try {
      const [eventRes, housesRes, eventTypesRes, activitiesRes] = await Promise.all([
        apiClient.get(`zoom-in/events/${editEventId}`),
        apiClient.get("houses/accessible"),
        apiClient.get("zoom-in/event-types"),
        apiClient.get("zoom-in/activities"),
      ]);
      const ev = eventRes.data;
      setHouses(housesRes.data);
      setEventTypes(eventTypesRes.data);
      setActivities(activitiesRes.data);

      setDate(ev.date);
      setEventTypeId(String(ev.event_type_id));
      setActivityId(String(ev.activity_id));
      setHouseId(String(ev.house_id));

      const [thanasRes, rsosRes, bpsRes] = await Promise.all([
        apiClient.get("zoom-in/thanas", { params: { house_id: ev.house_id } }),
        apiClient.get(`zoom-in/rsos-by-house/${ev.house_id}`),
        apiClient.get(`zoom-in/bps-by-house/${ev.house_id}`),
      ]);
      setThanas(thanasRes.data);
      setRsos(rsosRes.data);
      setBps(bpsRes.data);

      setThana(ev.thana);

      const btsRes = await apiClient.get(`zoom-in/bts-by-thana/${encodeURIComponent(ev.thana)}`, {
        params: { house_id: ev.house_id },
      });
      setBtsList(btsRes.data);

      setSelectedBtsIds(ev.bts_details?.map((b: any) => b.id) || []);
      setSelectedRsoIds(ev.rso_details?.map((r: any) => r.id) || []);
      setSelectedBpIds(ev.bp_details?.map((b: any) => b.id) || []);

      if (ev.house_id) {
        const retRes = await apiClient.get("zoom-in/retailers-by-rso", {
          params: { house_id: ev.house_id },
        });
        setRetailers(retRes.data);
        setSelectedRetailers(ev.retailer_details?.map((r: any) => r.retailer_code) || []);
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
      suppressEffects.current = false;
    }
  };

  useEffect(() => {
    if (!houseId || suppressEffects.current) return;
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
    if (!houseId || suppressEffects.current) return;
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
    if (suppressEffects.current) return;
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
    if (suppressEffects.current) return;
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
    // Normalize date to YYYY-MM-DD string or null for Pydantic v2 compatibility
    const normalizeDate = (d: string): string | null => {
      if (!d) return null;
      // If already YYYY-MM-DD, return as-is
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      try {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return null;
        return dt.toISOString().split("T")[0];
      } catch { return null; }
    };
    const basePayload: Record<string, any> = {
      date: normalizeDate(date),
      event_type_id: eventTypeId ? Number(eventTypeId) : null,
      activity_id: activityId ? Number(activityId) : null,
      thana: thana || null,
      bts_ids: selectedBtsIds,
      rso_ids: selectedRsoIds,
      bp_ids: selectedBpIds,
      retailer_codes: finalRetailers,
    };
    if (!isEditing) {
      basePayload.house_id = houseId ? Number(houseId) : null;
    }
    console.log("ZoomIn payload:", JSON.stringify(basePayload, null, 2));
    try {
      if (isEditing) {
        await apiClient.put(`zoom-in/events/${editEventId}`, basePayload);
        toast.success(t("zoom_in.messages.update_success"));
      } else {
        await apiClient.post("zoom-in/events", basePayload);
        toast.success(t("zoom_in.messages.create_success"));
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (detail) {
        toast.error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      } else {
        toast.error(err.message || t("common.error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 w-full sm:max-w-4xl sm:rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 my-0 sm:my-6 min-h-screen sm:min-h-0">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 flex items-center justify-between p-4 sm:p-6 border-b border-gray-100 dark:border-slate-800 rounded-t-none sm:rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {isEditing ? t("zoom_in.edit_event") || "Edit Event" : t("zoom_in.create_event")}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("zoom_in.description")}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="p-6 space-y-6">
            <div className="h-8 w-48 bg-gray-200 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="h-16 bg-gray-100 dark:bg-slate-900 rounded-xl animate-pulse" />
              ))}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6">
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
                    label: b.bts_code,
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
                    label: r.name || r.dms_code,
                    sublabel: [r.itop_number, r.assisted_retailer_code].filter(Boolean).join(" · ") || undefined,
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
                    label: b.name || b.dms_code,
                    sublabel: [b.pool_number ? `Pool: ${b.pool_number}` : null, b.assisted_retailer_code].filter(Boolean).join(" · ") || undefined,
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
                    badge: String(r.activation_count),
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
                onClick={onClose}
                className="px-6 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-bold hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isEditing ? (
                  <Pencil className="w-4 h-4" />
                ) : null}
                {isEditing ? t("common.save_changes") : t("zoom_in.create_event")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
