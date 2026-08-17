"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  SlidersHorizontal, Building2, Loader2, RefreshCw, FileSpreadsheet,
  MessageCircle, ChevronDown, ChevronUp, Check, Plus, Pencil, Trash2,
  CalendarDays, Save, FolderOpen, Filter, Columns3, ArrowUpDown,
  Search, X, GripVertical, ChevronRight,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import WhatsAppShareModal, { type ReportPayloadConfig } from "./WhatsAppShareModal";

/* ─────────── types ─────────── */

interface ColumnOption {
  key: string;
  label: string;
  type: "string" | "number";
}

interface EntityOption {
  id: number;
  code: string;
  name: string;
  itop_number: string;
  rso_name?: string;
}

interface TagOption {
  id: number;
  name: string;
}

interface EventItem {
  id: number;
  house_id: number;
  name: string;
  start_date: string;
  end_date: string;
  description: string | null;
}

interface TemplateItem {
  id: number;
  house_id: number;
  name: string;
  event_id: number | null;
  config: Record<string, unknown>;
}

interface ReportRow {
  [key: string]: string | number;
}

interface ReportData {
  columns: string[];
  rows: ReportRow[];
  totals: Record<string, number>;
  window: {
    start: string;
    end: string;
    today: string;
    today_source: string | null;
  };
}

interface Payload {
  event_id: number | null;
  start_date: string;
  end_date: string;
  retailer_codes: string[];
  rso_ids: number[];
  columns: string[];
  filters: {
    exclude_product_codes: string[];
    exclude_retailer_tags: string[];
  };
  sort_by: string;
  sort_order: string;
}

/* ─────────── default payload ─────────── */

function defaultColumns(): string[] {
  return ["retailer_code", "retailer_name", "activation_count"];
}

function emptyPayload(): Payload {
  return {
    event_id: null,
    start_date: "",
    end_date: "",
    retailer_codes: [],
    rso_ids: [],
    columns: defaultColumns(),
    filters: {
      exclude_product_codes: [],
      exclude_retailer_tags: [],
    },
    sort_by: "activation_count",
    sort_order: "desc",
  };
}

/* ─────────── Skeleton ─────────── */
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-gray-200 dark:bg-slate-700 rounded-xl", className)} />;
}

function PageSkeleton() {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-80 mt-2" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-gray-100 dark:border-slate-700/50 p-5 space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-5">
          <Skeleton className="h-5 w-40 mb-4" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-2 py-3">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2.5 w-24" />
              </div>
              <div className="hidden sm:block flex-1 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-2.5 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────── House Selector ─────────── */
function HouseSelector({
  houses,
  selected,
  onSelect,
  loading,
}: {
  houses: Array<{ id: number; name: string; code: string }>;
  selected: number | null;
  onSelect: (id: number) => void;
  loading?: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedHouse = houses.find((h) => h.id === selected) ?? null;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (houses.length <= 1) return null;

  return (
    <div ref={ref} className="relative mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-left min-h-[48px]"
      >
        <Building2 className="w-5 h-5 text-primary-500" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">{t("ga_report_builder.filters.house")}</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
            {selectedHouse ? selectedHouse.name : loading ? "..." : "—"}
          </p>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-xl overflow-hidden">
          {houses.map((h) => (
            <button
              key={h.id}
              onClick={() => { onSelect(h.id); setOpen(false); }}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-slate-700/50 min-h-[44px]",
                h.id === selected ? "text-primary-600 dark:text-primary-400 font-medium" : "text-gray-700 dark:text-gray-300"
              )}
            >
              <span className="truncate">{h.name}</span>
              {h.id === selected && <Check className="w-4 h-4 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Searchable Multi Select ─────────── */
interface SearchableMultiProps {
  label: string;
  placeholder: string;
  items: EntityOption[] | TagOption[];
  selectedKeys: string[];
  onToggle: (key: string) => void;
  onSearch: (q: string) => void;
  loading: boolean;
  searchable?: boolean;
  displayField: "code" | "name";
  secondaryField?: "code" | "name" | "rso_name" | "itop_number";
}

function SearchableMulti({
  label, placeholder, items, selectedKeys = [], onToggle, onSearch, loading,
  searchable = true, displayField, secondaryField,
}: SearchableMultiProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const keyOf = (item: EntityOption | TagOption) => String("code" in item ? item.code : item.id);
  const isTag = (item: EntityOption | TagOption): item is TagOption => !("code" in item);

  return (
    <div ref={ref} className="relative">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 min-h-[44px]"
      >
        <span className="truncate">
          {selectedKeys.length === 0 ? placeholder : `${selectedKeys.length} selected`}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-xl overflow-hidden">
          {searchable && (
            <div className="relative p-2 border-b border-gray-100 dark:border-slate-700">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); onSearch(e.target.value); }}
                placeholder={placeholder}
                className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1">
            {loading && (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading...
              </div>
            )}
            {!loading && items.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-400">No results</p>
            )}
            {items.map((item) => {
              const key = keyOf(item);
              const selected = selectedKeys.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onToggle(key)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700/50 min-h-[44px]",
                    selected && "bg-primary-50 dark:bg-primary-500/10"
                  )}
                >
                  <span className={cn(
                    "w-4 h-4 rounded border shrink-0 flex items-center justify-center",
                    selected ? "bg-primary-500 border-primary-500" : "border-gray-300 dark:border-slate-600"
                  )}>
                    {selected && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium text-gray-800 dark:text-gray-200">
                      {String((item as EntityOption)[displayField] ?? "")}
                    </span>
                    {secondaryField && (
                      <span className="block text-[11px] text-gray-400 truncate">
                        {isTag(item) ? "" : String((item as EntityOption)[secondaryField] ?? "")}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────── Column Picker ─────────── */
function ColumnPicker({
  allColumns, selected, onChange,
}: {
  allColumns: ColumnOption[];
  selected: string[];
  onChange: (cols: string[]) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (key: string) => {
    if (selected.includes(key)) {
      onChange(selected.filter((c) => c !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...selected];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div ref={ref} className="relative">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
        {t("ga_report_builder.filters.columns")}
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 min-h-[44px]"
      >
        <span className="truncate">{selected.length === 0 ? "—" : `${selected.length} selected`}</span>
        <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute z-40 mt-2 w-72 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {allColumns.map((col) => {
              const isSel = selected.includes(col.key);
              return (
                <button
                  key={col.key}
                  type="button"
                  onClick={() => toggle(col.key)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700/50 min-h-[40px]",
                    isSel && "bg-primary-50 dark:bg-primary-500/10"
                  )}
                >
                  <span className={cn(
                    "w-4 h-4 rounded border shrink-0 flex items-center justify-center",
                    isSel ? "bg-primary-500 border-primary-500" : "border-gray-300 dark:border-slate-600"
                  )}>
                    {isSel && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="flex-1 truncate">{col.label}</span>
                </button>
              );
            })}
          </div>
          {selected.length > 1 && (
            <div className="border-t border-gray-100 dark:border-slate-700 py-2 px-3 space-y-1">
              <p className="text-[11px] text-gray-400">Order</p>
              {selected.map((key, i) => (
                <div key={key} className="flex items-center gap-2">
                  <GripVertical className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 shrink-0" />
                  <span className="flex-1 truncate text-xs text-gray-700 dark:text-gray-300">
                    {allColumns.find((c) => c.key === key)?.label ?? key}
                  </span>
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === selected.length - 1}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────── Event Manager Modal ─────────── */
function EventManagerModal({
  open, onClose, houseId, events, onSaved, canEdit, canDelete,
}: {
  open: boolean;
  onClose: () => void;
  houseId: number | null;
  events: EventItem[];
  onSaved: () => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setStart("");
    setEnd("");
    setEditingId(null);
  };

  useEffect(() => {
    if (open) reset();
  }, [open]);

  const startEdit = (e: EventItem) => {
    setEditingId(e.id);
    setName(e.name);
    setDescription(e.description ?? "");
    setStart(e.start_date);
    setEnd(e.end_date);
  };

  const save = async () => {
    if (!houseId) return;
    if (!name.trim() || !start || !end) {
      toast.error("Name, start date and end date are required");
      return;
    }
    if (start > end) {
      toast.error("Start date cannot be after end date");
      return;
    }
    setSaving(true);
    try {
      const body = { name: name.trim(), start_date: start, end_date: end, description: description || null };
      if (editingId) {
        await apiClient.patch(`/ga-report-builder/events/${editingId}`, body);
        toast.success(t("ga_report_builder.event.update_success"));
      } else {
        await apiClient.post("/ga-report-builder/events", body, { params: { house_id: houseId } });
        toast.success(t("ga_report_builder.event.create_success"));
      }
      reset();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: EventItem) => {
    if (!window.confirm(t("ga_report_builder.event.delete_confirm"))) return;
    try {
      await apiClient.delete(`/ga-report-builder/events/${e.id}`);
      toast.success(t("ga_report_builder.event.delete_success"));
      if (editingId === e.id) reset();
      onSaved();
    } catch (err) {
      toast.error((err as Error).message || "Delete failed");
    }
  };

  return (
    <div className={cn("fixed inset-0 z-[90] flex items-center justify-center bg-black/65 backdrop-blur-md p-4", !open && "hidden")}>
      <motion.div
        initial={{ scale: 0.96, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        className="w-full max-w-2xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-3xl border border-gray-200 dark:border-slate-700/80 shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
            <CalendarDays className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 dark:text-gray-100">{t("ga_report_builder.event.manage")}</h3>
          </div>
          <button onClick={() => { reset(); onClose(); }} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* form */}
          <div className="rounded-2xl border border-gray-200 dark:border-slate-700/60 p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              {editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {editingId ? t("ga_report_builder.event.edit") : t("ga_report_builder.event.create")}
            </p>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.event.name")}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("ga_report_builder.event.name_placeholder")}
                className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.event.start_date")}</label>
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.event.end_date")}</label>
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.event.description")}</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              {editingId && (
                <button onClick={reset} className="px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400">
                  Cancel
                </button>
              )}
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>

          {/* list */}
          <div className="space-y-2">
            {events.length === 0 ? (
              <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-4 text-center">
                {t("ga_report_builder.event.no_events")}
              </p>
            ) : (
              events.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-slate-700/60 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">{e.name}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {e.start_date} → {e.end_date}
                      {e.description ? ` · ${e.description}` : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <button onClick={() => startEdit(e)} className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800" title="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => remove(e)} className="p-2 rounded-lg border border-red-200 dark:border-red-500/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─────────── Report Table (desktop + mobile accordion) ─────────── */
function ReportTable({
  columns, rows, totals, columnMeta,
}: {
  columns: string[];
  rows: ReportRow[];
  totals: Record<string, number>;
  columnMeta: Record<string, ColumnOption>;
}) {
  const { t } = useLanguage();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortedRows, setSortedRows] = useState<ReportRow[]>(rows);

  useEffect(() => { setSortedRows(rows); }, [rows]);

  const label = (key: string) => columnMeta[key]?.label ?? key;
  const fmt = (key: string, val: string | number) => {
    if (columnMeta[key]?.type === "number") return Number(val).toLocaleString();
    return String(val ?? "—");
  };
  const isNum = (key: string) => columnMeta[key]?.type === "number";

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/30 px-4 py-10 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("ga_report_builder.builder.no_data")}</p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60">
              <th className="px-2 py-2 text-left font-semibold text-xs text-gray-500 dark:text-gray-400 w-10">#</th>
              {columns.map((c) => (
                <th key={c} className="px-2 py-2 text-left font-semibold text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {label(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {sortedRows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                <td className="px-2 py-1 text-gray-400 text-xs">{i + 1}</td>
                {columns.map((c) => (
                  <td key={c} className={cn("px-2 py-1", isNum(c) && "tabular-nums")}>
                    <span className={cn(isNum(c) && "font-medium")}>{fmt(c, row[c])}</span>
                  </td>
                ))}
              </tr>
            ))}
            {Object.keys(totals).length > 0 && (
              <tr className="border-t-2 border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60">
                <td className="px-2 py-2">
                  <span className="text-xs text-gray-400 uppercase">{t("ga_report_builder.builder.totals")}</span>
                </td>
                {columns.map((c) => (
                  <td key={c} className="px-2 py-2">
                    {c in totals ? (
                      <span className="font-bold text-primary-600 dark:text-primary-400 tabular-nums">{fmt(c, totals[c])}</span>
                    ) : (
                      <span className="text-xs text-gray-400 uppercase">—</span>
                    )}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile accordion */}
      <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
        {sortedRows.map((row, i) => {
          const primaryKey = columns.find((c) => c === "retailer_name" || c === "retailer_code") ?? columns[0];
          const expanded = expandedId === i;
          return (
            <div key={i} className="py-1">
              <button
                onClick={() => setExpandedId(expanded ? null : i)}
                className="w-full flex items-center gap-3 px-2 py-3 text-left"
              >
                <span className="w-6 h-6 rounded-lg bg-gray-100 dark:bg-slate-700/60 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">{String(row[primaryKey] ?? "")}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {columns.filter((c) => c !== primaryKey).slice(0, 2).map((c) => `${label(c)}: ${fmt(c, row[c])}`).join(" · ")}
                  </p>
                </div>
                <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform", expanded && "rotate-180")} />
              </button>
              {expanded && (
                <div className="px-2 pb-3 space-y-1.5">
                  {columns.map((c) => (
                    <div key={c} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{label(c)}</span>
                      <span className={cn("text-sm font-medium text-gray-800 dark:text-gray-200", isNum(c) && "tabular-nums")}>
                        {fmt(c, row[c])}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ─────────── Main Page ─────────── */
export default function GaReportBuilderPage() {
  const { user, hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [allHouses, setAllHouses] = useState<Array<{ id: number; name: string; code: string }> | null>(null);
  const [selectedHouseId, setSelectedHouseId] = useState<number | null>(null);

  const [columnsMeta, setColumnsMeta] = useState<ColumnOption[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [productCodes, setProductCodes] = useState<string[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);

  const [retailerItems, setRetailerItems] = useState<EntityOption[]>([]);
  const [retailerLoading, setRetailerLoading] = useState(false);
  const [rsoItems, setRsoItems] = useState<EntityOption[]>([]);
  const [rsoLoading, setRsoLoading] = useState(false);

  const [payload, setPayload] = useState<Payload>(emptyPayload());
  const [report, setReport] = useState<ReportData | null>(null);
  const [building, setBuilding] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [waModalOpen, setWaModalOpen] = useState(false);

  const canCreate = hasPermission("ga_report_builder.create");
  const canEdit = hasPermission("ga_report_builder.edit");
  const canDelete = hasPermission("ga_report_builder.delete");
  const canExport = hasPermission("ga_report_builder.export");
  const canSend = hasPermission("ga_report_builder.send");

  const assignedHouses = useMemo(() => user?.houses ?? [], [user]);
  const houses = useMemo(() => allHouses ?? assignedHouses, [allHouses, assignedHouses]);
  const housesLoading = assignedHouses.length === 0 && allHouses === null;

  const effectiveHouseId = useMemo(
    () => selectedHouseId ?? (houses.length === 1 ? houses[0].id : null),
    [selectedHouseId, houses]
  );

  const columnMeta = useMemo(() => Object.fromEntries(columnsMeta.map((c) => [c.key, c])), [columnsMeta]);

  /* ── initial loads ── */
  useEffect(() => {
    if (assignedHouses.length === 0 && !allHouses) {
      apiClient.get("/houses/accessible").then(res => setAllHouses(res.data)).catch(() => {});
    }
    apiClient.get("/ga-report-builder/columns").then(res => {
      const cols: ColumnOption[] = res.data?.data ?? [];
      setColumnsMeta(cols);
    }).catch(() => {});
  }, [assignedHouses, allHouses]);

  const loadEvents = useCallback(async (houseId: number | null) => {
    if (!houseId) return;
    try {
      const res = await apiClient.get("/ga-report-builder/events", { params: { house_id: houseId } });
      setEvents(res.data?.data ?? []);
    } catch { /* silent */ }
  }, []);

  const loadTemplates = useCallback(async (houseId: number | null) => {
    if (!houseId) return;
    try {
      const res = await apiClient.get("/ga-report-builder/templates", { params: { house_id: houseId } });
      setTemplates(res.data?.data ?? []);
    } catch { /* silent */ }
  }, []);

  const loadExclusions = useCallback(async (houseId: number | null) => {
    if (!houseId) return;
    try {
      const res = await apiClient.get("/ga-report-builder/exclusions", { params: { house_id: houseId } });
      const d = res.data?.data;
      setProductCodes(d?.product_codes ?? []);
      setTags(d?.retailer_tags ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!effectiveHouseId) return;
    setPayload((p) => ({ ...emptyPayload(), columns: p.columns }));
    loadEvents(effectiveHouseId);
    loadTemplates(effectiveHouseId);
    loadExclusions(effectiveHouseId);
    setReport(null);
  }, [effectiveHouseId, loadEvents, loadTemplates, loadExclusions]);

  /* ── entity search ── */
  const searchRetailers = useCallback(async (q: string) => {
    if (!effectiveHouseId) return;
    setRetailerLoading(true);
    try {
      const res = await apiClient.get("/ga-report-builder/entities", {
        params: { entity_type: "retailer", search: q || undefined, house_id: effectiveHouseId },
      });
      setRetailerItems(res.data?.data ?? []);
    } catch { /* silent */ } finally {
      setRetailerLoading(false);
    }
  }, [effectiveHouseId]);

  const searchRsos = useCallback(async (q: string) => {
    if (!effectiveHouseId) return;
    setRsoLoading(true);
    try {
      const res = await apiClient.get("/ga-report-builder/entities", {
        params: { entity_type: "rso", search: q || undefined, house_id: effectiveHouseId },
      });
      setRsoItems(res.data?.data ?? []);
    } catch { /* silent */ } finally {
      setRsoLoading(false);
    }
  }, [effectiveHouseId]);

  useEffect(() => { if (effectiveHouseId) { searchRetailers(""); searchRsos(""); } }, [effectiveHouseId, searchRetailers, searchRsos]);

  /* ── payload helpers ── */
  const updatePayload = (patch: Partial<Payload>) => setPayload((p) => ({ ...p, ...patch }));

  const selectEvent = (eventId: number | null) => {
    const ev = events.find((e) => e.id === eventId);
    updatePayload({
      event_id: eventId,
      start_date: ev ? ev.start_date : "",
      end_date: ev ? ev.end_date : "",
    });
  };

  const build = async () => {
    if (!effectiveHouseId) {
      toast.error("Select a house first");
      return;
    }
    if (!payload.start_date || !payload.end_date) {
      toast.error("Select an event or pick a date range");
      return;
    }
    if (payload.start_date > payload.end_date) {
      toast.error("Start date cannot be after end date");
      return;
    }
    setBuilding(true);
    try {
      const body = { ...payload, house_id: effectiveHouseId };
      const res = await apiClient.post("/ga-report-builder/report", body);
      setReport(res.data?.data ?? null);
    } catch (e) {
      toast.error((e as Error).message || t("ga_report_builder.messages.build_error"));
    } finally {
      setBuilding(false);
    }
  };

  const reset = () => {
    setPayload(emptyPayload());
    setReport(null);
  };

  const saveTemplate = async () => {
    if (!effectiveHouseId) return;
    const name = window.prompt(t("ga_report_builder.builder.template_name"));
    if (!name) return;
    setSavingTemplate(true);
    try {
      await apiClient.post("/ga-report-builder/templates", {
        name: name.trim(),
        event_id: payload.event_id,
        config: { ...payload, event_id: payload.event_id },
      }, { params: { house_id: effectiveHouseId } });
      toast.success(t("ga_report_builder.builder.template_saved"));
      loadTemplates(effectiveHouseId);
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSavingTemplate(false);
    }
  };

  const loadTemplate = async (template: TemplateItem) => {
    const cfg = (template.config ?? {}) as Partial<Payload>;
    const filters = (cfg.filters ?? {}) as Payload["filters"];
    setPayload({
      event_id: cfg.event_id ?? template.event_id ?? null,
      start_date: cfg.start_date ?? "",
      end_date: cfg.end_date ?? "",
      retailer_codes: cfg.retailer_codes ?? [],
      rso_ids: cfg.rso_ids ?? [],
      columns: (cfg.columns ?? defaultColumns()).length > 0 ? (cfg.columns ?? defaultColumns()) : defaultColumns(),
      filters: {
        exclude_product_codes: filters.exclude_product_codes ?? [],
        exclude_retailer_tags: filters.exclude_retailer_tags ?? [],
      },
      sort_by: cfg.sort_by ?? "activation_count",
      sort_order: cfg.sort_order ?? "desc",
    });
    setReport(null);
    toast.success(`Loaded: ${template.name}`);
  };

  const exportExcel = async () => {
    if (!effectiveHouseId || !report) return;
    try {
      const res = await apiClient.post("/ga-report-builder/report/export", { ...payload, house_id: effectiveHouseId }, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ga_report_${payload.start_date}_${payload.end_date}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t("ga_report_builder.messages.export_success"));
    } catch (e) {
      toast.error((e as Error).message || t("ga_report_builder.messages.export_failed"));
    }
  };

  const waPayload = useMemo<ReportPayloadConfig>(() => ({
    event_id: payload.event_id,
    start_date: payload.start_date || null,
    end_date: payload.end_date || null,
    retailer_codes: payload.retailer_codes,
    rso_ids: payload.rso_ids,
    columns: payload.columns,
    filters: payload.filters,
    sort_by: payload.sort_by,
    sort_order: payload.sort_order,
  }), [payload]);

  /* auth guard */
  if (authLoading) return <PageSkeleton />;
  if (!hasPermission("ga_report_builder.view")) return <AccessDenied />;

  const retailerToggle = (code: string) => {
    updatePayload({
      retailer_codes: payload.retailer_codes.includes(code)
        ? payload.retailer_codes.filter((c) => c !== code)
        : [...payload.retailer_codes, code],
    });
  };
  const rsoToggle = (id: number) => {
    updatePayload({
      rso_ids: payload.rso_ids.includes(id)
        ? payload.rso_ids.filter((x) => x !== id)
        : [...payload.rso_ids, id],
    });
  };
  const tagToggle = (id: number) => {
    const tag = tags.find((tg) => tg.id === id);
    if (!tag) return;
    updatePayload({
      filters: {
        ...payload.filters,
        exclude_retailer_tags: payload.filters.exclude_retailer_tags.includes(tag.name)
          ? payload.filters.exclude_retailer_tags.filter((x) => x !== tag.name)
          : [...payload.filters.exclude_retailer_tags, tag.name],
      },
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2.5">
            <SlidersHorizontal className="w-6 h-6 text-primary-500" />
            {t("ga_report_builder.title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("ga_report_builder.subtitle")}</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setEventModalOpen(true)}
            className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
          >
            <CalendarDays className="w-4 h-4" />
            {t("ga_report_builder.event.manage")}
          </button>
        )}
      </div>

      <HouseSelector houses={houses} selected={selectedHouseId} onSelect={setSelectedHouseId} loading={housesLoading} />

      {!effectiveHouseId ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Building2 className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">{t("ga_report_builder.filters.house")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Configuration panel ── */}
          <div className="lg:col-span-1 space-y-5">
            <div className="rounded-2xl border border-gray-100 dark:border-slate-700/50 bg-white dark:bg-slate-800/60 p-5">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-4">
                <CalendarDays className="w-4 h-4 text-primary-500" />
                {t("ga_report_builder.builder.config_title")}
              </p>

              {/* Event */}
              <div className="space-y-1.5 mb-4">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block">{t("ga_report_builder.filters.event")}</label>
                <div className="flex gap-2">
                  <select
                    value={payload.event_id ?? ""}
                    onChange={(e) => selectEvent(e.target.value ? Number(e.target.value) : null)}
                    className="flex-1 min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                  >
                    <option value="">{t("ga_report_builder.filters.no_event")}</option>
                    {events.map((e) => (
                      <option key={e.id} value={e.id}>{e.name} ({e.start_date} → {e.end_date})</option>
                    ))}
                  </select>
                  {canCreate && (
                    <button
                      onClick={() => setEventModalOpen(true)}
                      className="w-[44px] shrink-0 rounded-xl border border-gray-200 dark:border-slate-700 flex items-center justify-center text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800"
                      title={t("ga_report_builder.event.create")}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-gray-400">{t("ga_report_builder.filters.or_dates")}</p>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.filters.from")}</label>
                  <input
                    type="date"
                    value={payload.start_date}
                    onChange={(e) => updatePayload({ start_date: e.target.value })}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.filters.to")}</label>
                  <input
                    type="date"
                    value={payload.end_date}
                    onChange={(e) => updatePayload({ end_date: e.target.value })}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                  />
                </div>
              </div>

              {/* Retailers */}
              <div className="mb-4">
                <SearchableMulti
                  label={t("ga_report_builder.filters.retailers")}
                  placeholder={t("ga_report_builder.filters.retailer_placeholder")}
                  items={retailerItems}
                  selectedKeys={payload.retailer_codes}
                  onToggle={retailerToggle}
                  onSearch={searchRetailers}
                  loading={retailerLoading}
                  displayField="code"
                  secondaryField="name"
                />
              </div>

              {/* RSOs */}
              <div className="mb-4">
                <SearchableMulti
                  label={t("ga_report_builder.filters.rso")}
                  placeholder={t("ga_report_builder.filters.rso_placeholder")}
                  items={rsoItems}
                  selectedKeys={payload.rso_ids.map(String)}
                  onToggle={(k) => rsoToggle(Number(k))}
                  onSearch={searchRsos}
                  loading={rsoLoading}
                  displayField="name"
                  secondaryField="code"
                />
              </div>

              {/* Columns */}
              <div className="mb-4">
                <ColumnPicker allColumns={columnsMeta} selected={payload.columns} onChange={(cols) => updatePayload({ columns: cols })} />
              </div>

              {/* Sort */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.filters.sort_by")}</label>
                  <select
                    value={payload.sort_by}
                    onChange={(e) => updatePayload({ sort_by: e.target.value })}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                  >
                    {payload.columns.map((c) => (
                      <option key={c} value={c}>{columnMeta[c]?.label ?? c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.filters.sort_order")}</label>
                  <select
                    value={payload.sort_order}
                    onChange={(e) => updatePayload({ sort_order: e.target.value })}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                  >
                    <option value="desc">{t("ga_report_builder.filters.desc")}</option>
                    <option value="asc">{t("ga_report_builder.filters.asc")}</option>
                  </select>
                </div>
              </div>

              {/* Exclusions */}
              <div className="mb-4 space-y-3">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5" /> {t("ga_report_builder.filters.exclusions")}
                </p>
                <SearchableMulti
                  label={t("ga_report_builder.filters.exclude_products")}
                  placeholder={t("ga_report_builder.filters.exclude_products_placeholder")}
                  items={productCodes.map((code) => ({ id: 0, code, name: code, itop_number: "" }))}
                  selectedKeys={payload.filters.exclude_product_codes}
                  onToggle={(code) => updatePayload({
                    filters: {
                      ...payload.filters,
                      exclude_product_codes: payload.filters.exclude_product_codes.includes(code)
                        ? payload.filters.exclude_product_codes.filter((c) => c !== code)
                        : [...payload.filters.exclude_product_codes, code],
                    },
                  })}
                  onSearch={() => {}}
                  loading={false}
                  searchable={false}
                  displayField="code"
                />
                <SearchableMulti
                  label={t("ga_report_builder.filters.exclude_tags")}
                  placeholder={t("ga_report_builder.filters.exclude_tags_placeholder")}
                  items={tags}
                  selectedKeys={payload.filters.exclude_retailer_tags}
                  onToggle={(k) => tagToggle(Number(k))}
                  onSearch={() => {}}
                  loading={false}
                  searchable={false}
                  displayField="name"
                />
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <button
                  onClick={build}
                  disabled={building}
                  className="w-full flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
                >
                  {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <SlidersHorizontal className="w-4 h-4" />}
                  {building ? t("ga_report_builder.builder.building") : t("ga_report_builder.builder.build")}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={reset}
                    className="flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> {t("ga_report_builder.builder.reset")}
                  </button>
                  {canCreate && (
                    <button
                      onClick={saveTemplate}
                      disabled={savingTemplate}
                      className="flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      {savingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {t("ga_report_builder.builder.save_template")}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Templates */}
            <div className="rounded-2xl border border-gray-100 dark:border-slate-700/50 bg-white dark:bg-slate-800/60 p-5">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-3">
                <FolderOpen className="w-4 h-4 text-primary-500" />
                {t("ga_report_builder.builder.templates")}
              </p>
              {templates.length === 0 ? (
                <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-3">
                  {t("ga_report_builder.builder.template_name_placeholder")}
                </p>
              ) : (
                <div className="space-y-2">
                  {templates.map((tp) => (
                    <button
                      key={tp.id}
                      onClick={() => loadTemplate(tp)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-left hover:bg-gray-50 dark:hover:bg-slate-800 min-h-[44px]"
                    >
                      <FolderOpen className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="flex-1 truncate text-sm text-gray-700 dark:text-gray-300">{tp.name}</span>
                      <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Preview ── */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-gray-100 dark:border-slate-700/50 bg-white dark:bg-slate-800/60 p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                    <Columns3 className="w-4 h-4 text-primary-500" />
                    {t("ga_report_builder.builder.preview_title")}
                  </p>
                  {report && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                      {report.window.start} → {report.window.end}
                      {report.window.today_source ? ` · ${t("ga_report_builder.builder.live")}` : ""}
                      {" · "}
                      {t("ga_report_builder.builder.rows", { count: report.rows.length })}
                    </p>
                  )}
                </div>
                {report && (
                  <div className="flex flex-wrap items-center gap-2">
                    {canExport && (
                      <button
                        onClick={exportExcel}
                        className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                      >
                        <FileSpreadsheet className="w-4 h-4" /> {t("ga_report_builder.builder.export_excel")}
                      </button>
                    )}
                    {canSend && (
                      <button
                        onClick={() => setWaModalOpen(true)}
                        className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                      >
                        <MessageCircle className="w-4 h-4" /> {t("ga_report_builder.builder.whatsapp")}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {building ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-2 py-3 animate-pulse">
                      <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                      <div className="space-y-2 flex-1">
                        <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                        <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                      </div>
                      <div className="hidden sm:block flex-1 space-y-2">
                        <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                        <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : report ? (
                <ReportTable columns={report.columns} rows={report.rows} totals={report.totals} columnMeta={columnMeta} />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <ArrowUpDown className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
                    {t("ga_report_builder.filters.columns_hint")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <EventManagerModal
        open={eventModalOpen}
        onClose={() => setEventModalOpen(false)}
        houseId={effectiveHouseId}
        events={events}
        onSaved={() => loadEvents(effectiveHouseId)}
        canEdit={canEdit}
        canDelete={canDelete}
      />
      <WhatsAppShareModal
        open={waModalOpen}
        houseId={effectiveHouseId}
        payload={waPayload}
        onClose={() => setWaModalOpen(false)}
      />
    </div>
  );
}
