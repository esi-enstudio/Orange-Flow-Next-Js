"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  SlidersHorizontal, Building2, Loader2, RefreshCw, FileSpreadsheet,
  MessageCircle, ChevronDown, ChevronUp, Check, Plus, Minus, Pencil, Trash2,
  CalendarDays, Save, FolderOpen, Filter, Columns3, ArrowUpDown,
  Search, X, GripVertical, ChevronRight, Lock,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import WhatsAppShareModal, { type ReportPayloadConfig } from "./WhatsAppShareModal";
import EntitySelector, { type SelectorItem } from "../../zoom-in/_components/EntitySelector";

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
  pool_number?: string;
  assisted_code?: string;
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
  config?: Record<string, unknown>;
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
  target_type: "rso" | "bp" | "retailer";
  retailer_codes: string[];
  rso_ids: number[];
  bp_ids: number[];
  slabs: number;
  columns: string[];
  filters: {
    exclude_product_codes: string[];
    exclude_retailer_tags: string[];
  };
  sort_by: string;
  sort_order: string;
  targets: TargetEntry[];
}

interface TargetEntry {
  entity_id?: number;
  retailer_code?: string;
  slab: number;
  target_value: number;
}

/* ─────────── default payload ─────────── */

function defaultColumns(): string[] {
  return ["retailer_code", "retailer_name"];
}

function emptyEventConfig(): Partial<Payload> {
  return {
    target_type: "retailer",
    retailer_codes: [],
    rso_ids: [],
    bp_ids: [],
    slabs: 1,
    columns: defaultColumns(),
    filters: {
      exclude_product_codes: [],
      exclude_retailer_tags: [],
    },
    sort_by: "retailer_code",
    sort_order: "desc",
  };
}

function emptyPayload(): Payload {
  return {
    event_id: null,
    start_date: "",
    end_date: "",
    target_type: "retailer",
    retailer_codes: [],
    rso_ids: [],
    bp_ids: [],
    slabs: 1,
    columns: defaultColumns(),
    filters: {
      exclude_product_codes: [],
      exclude_retailer_tags: [],
    },
    sort_by: "retailer_code",
    sort_order: "desc",
    targets: [],
  };
}

function persistableKey(p: Payload): string {
  const sortedTargets = [...(p.targets ?? [])].sort((a, b) => {
    const ka = String(a.entity_id ?? a.retailer_code ?? "");
    const kb = String(b.entity_id ?? b.retailer_code ?? "");
    return ka.localeCompare(kb) || a.slab - b.slab;
  });
  return JSON.stringify({
    target_type: p.target_type,
    rso_ids: p.rso_ids,
    bp_ids: p.bp_ids,
    retailer_codes: p.retailer_codes,
    slabs: p.slabs,
    columns: p.columns,
    filters: p.filters,
    sort_by: p.sort_by,
    sort_order: p.sort_order,
    targets: sortedTargets,
  });
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
  secondaryField?: "code" | "name" | "rso_name" | "itop_number" | "pool_number";
  keyField?: "code" | "id" | "name";
}

function SearchableMulti({
  label, placeholder, items, selectedKeys = [], onToggle, onSearch, loading,
  searchable = true, displayField, secondaryField, keyField,
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

  const keyOf = (item: EntityOption | TagOption) => {
    if (keyField === "id") return String(item.id);
    if (keyField === "name") return String((item as TagOption).name);
    return String("code" in item ? item.code : item.id);
  };
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

  const labelOf = (key: string, fallback: string = key) => {
    const translated = t(`ga_report_builder.columns.${key}`);
    return translated !== `ga_report_builder.columns.${key}` ? translated : fallback;
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
                  <span className="flex-1 truncate">{labelOf(col.key, col.label || col.key)}</span>
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
                    {labelOf(key, allColumns.find((c) => c.key === key)?.label ?? key)}
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
  open, onClose, houseId, events, onSaved, canCreate, canEdit, canDelete, canPermanentDelete,
  columnsMeta, rsoItems, bpItems, fetchAllEntities,
  productCodes, tags,
}: {
  open: boolean;
  onClose: () => void;
  houseId: number | null;
  events: EventItem[];
  onSaved: (eventId: number) => void;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPermanentDelete: boolean;
  columnsMeta: ColumnOption[];
  rsoItems: EntityOption[];
  bpItems: EntityOption[];
  fetchAllEntities: (type: "rso" | "bp" | "retailer") => Promise<EntityOption[]>;
  productCodes: string[];
  tags: TagOption[];
}) {
  const { t } = useLanguage();
  const todayStr = (() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  })();
  const isEventLocked = (e: EventItem) => e.end_date < todayStr;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ event: EventItem; permanent: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [config, setConfig] = useState<Partial<Payload>>(emptyEventConfig());
  const [targetValues, setTargetValues] = useState<Record<string, Record<number, number>>>({});
  const [uploadedTargets, setUploadedTargets] = useState<TargetEntry[]>([]);
  const [uploadSlab, setUploadSlab] = useState(1);
  const [uploadRows, setUploadRows] = useState<Array<{ retailer_code: string; target_value: number | null; valid_target: boolean; valid_retailer: boolean }>>([]);
  const [uploadSummary, setUploadSummary] = useState<{ total: number; matched: number; invalid: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localRsoItems, setLocalRsoItems] = useState<EntityOption[]>([]);
  const [localBpItems, setLocalBpItems] = useState<EntityOption[]>([]);
  const [modalEntityItems, setModalEntityItems] = useState<Record<"rso" | "bp" | "retailer", SelectorItem[]>>({
    rso: [], bp: [], retailer: [],
  });
  const [modalEntityLoading, setModalEntityLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toSelectorItems = (type: "rso" | "bp" | "retailer", list: EntityOption[]): SelectorItem[] => {
    if (type === "retailer") {
      return list.map((i) => ({ id: i.code, label: i.code, sublabel: i.name }));
    }
    if (type === "bp") {
      return list.map((i) => ({ id: i.id, label: i.name, sublabel: i.pool_number || i.code }));
    }
    return list.map((i) => ({ id: i.id, label: i.name, sublabel: i.code }));
  };

  const loadModalEntities = async (type: "rso" | "bp" | "retailer") => {
    setModalEntityLoading(true);
    try {
      const all = await fetchAllEntities(type);
      setModalEntityItems((prev) => ({ ...prev, [type]: toSelectorItems(type, all) }));
    } catch { /* silent */ } finally {
      setModalEntityLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      const type = (config.target_type ?? "retailer") as "rso" | "bp" | "retailer";
      void loadModalEntities(type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config.target_type]);

  const updateConfig = (patch: Partial<Payload>) => setConfig((c) => ({ ...c, ...patch }));

  const entityRows = useMemo(() => {
    const type = config.target_type ?? "retailer";
    const map = new Map<number, { id: number; name: string; code: string }>();
    if (type === "rso") {
      for (const s of modalEntityItems.rso) map.set(Number(s.id), { id: Number(s.id), name: s.label, code: s.sublabel ?? "" });
      for (const i of [...localRsoItems, ...rsoItems]) map.set(i.id, { id: i.id, name: i.name, code: i.code });
      return (config.rso_ids ?? []).map((id) => map.get(id)).filter((x): x is { id: number; name: string; code: string } => Boolean(x));
    }
    if (type === "bp") {
      for (const s of modalEntityItems.bp) map.set(Number(s.id), { id: Number(s.id), name: s.label, code: s.sublabel ?? "" });
      for (const i of [...localBpItems, ...bpItems]) map.set(i.id, { id: i.id, name: i.name, code: i.code });
      return (config.bp_ids ?? []).map((id) => map.get(id)).filter((x): x is { id: number; name: string; code: string } => Boolean(x));
    }
    return [];
  }, [config.target_type, config.rso_ids, config.bp_ids, rsoItems, bpItems, localRsoItems, localBpItems, modalEntityItems]);

  const columnLabel = (key: string) => {
    const translated = t(`ga_report_builder.columns.${key}`);
    return translated !== `ga_report_builder.columns.${key}` ? translated : key;
  };

  const reset = () => {
    setName("");
    setDescription("");
    setStart("");
    setEnd("");
    setEditingId(null);
    setConfig(emptyEventConfig());
    setTargetValues({});
    setUploadedTargets([]);
    setUploadRows([]);
    setUploadSummary(null);
    setUploadSlab(1);
    setLocalRsoItems([]);
    setLocalBpItems([]);
  };

  useEffect(() => {
    if (open) reset();
  }, [open]);

  const startEdit = async (e: EventItem) => {
    const cfg = (e.config ?? {}) as Partial<Payload>;
    setEditingId(e.id);
    setName(e.name);
    setDescription(e.description ?? "");
    setStart(e.start_date);
    setEnd(e.end_date);
    const type = cfg.target_type ?? "retailer";
    setConfig({
      target_type: type,
      retailer_codes: cfg.retailer_codes ?? [],
      rso_ids: cfg.rso_ids ?? [],
      bp_ids: cfg.bp_ids ?? [],
      slabs: cfg.slabs && cfg.slabs > 0 ? cfg.slabs : 1,
      columns: (cfg.columns && cfg.columns.length > 0) ? cfg.columns : defaultColumns(),
      filters: {
        exclude_product_codes: cfg.filters?.exclude_product_codes ?? [],
        exclude_retailer_tags: cfg.filters?.exclude_retailer_tags ?? [],
      },
      sort_by: cfg.sort_by ?? "retailer_code",
      sort_order: cfg.sort_order ?? "desc",
    });
    setUploadedTargets([]);
    setUploadRows([]);
    setUploadSummary(null);
    setTargetValues({});
    try {
      const res = await apiClient.get(`/ga-report-builder/events/${e.id}/targets`);
      const list = (res.data?.data ?? []) as Array<{ target_type: string; entity_id: number | null; retailer_code: string | null; slab: number; target_value: number }>;
      const values: Record<string, Record<number, number>> = {};
      const ups: TargetEntry[] = [];
      for (const it of list) {
        if (it.target_type !== type) continue;
        if (it.retailer_code) {
          ups.push({ retailer_code: it.retailer_code, slab: it.slab, target_value: it.target_value });
        } else if (it.entity_id != null) {
          const key = String(it.entity_id);
          values[key] = { ...(values[key] ?? {}), [it.slab]: it.target_value };
        }
      }
      setTargetValues(values);
      setUploadedTargets(ups);
    } catch { /* silent */ }
    if (type === "rso") {
      const all = await fetchAllEntities("rso");
      if (all.length > 0) setLocalRsoItems(all);
    } else if (type === "bp") {
      const all = await fetchAllEntities("bp");
      if (all.length > 0) setLocalBpItems(all);
    }
  };

  const productToggle = (code: string) => {
    const codes = config.filters?.exclude_product_codes ?? [];
    const tags = config.filters?.exclude_retailer_tags ?? [];
    updateConfig({
      filters: {
        exclude_product_codes: codes.includes(code) ? codes.filter((x) => x !== code) : [...codes, code],
        exclude_retailer_tags: tags,
      },
    });
  };

  const tagToggle = (name: string) => {
    const tags = config.filters?.exclude_retailer_tags ?? [];
    const codes = config.filters?.exclude_product_codes ?? [];
    updateConfig({
      filters: {
        exclude_product_codes: codes,
        exclude_retailer_tags: tags.includes(name) ? tags.filter((x) => x !== name) : [...tags, name],
      },
    });
  };

  const setTargetType = (type: "rso" | "bp" | "retailer") => {
    updateConfig({ target_type: type });
    setTargetValues({});
    setUploadedTargets([]);
    setUploadRows([]);
    setUploadSummary(null);
  };

  const adjustSlabs = (delta: number) => {
    const next = Math.min(10, Math.max(1, (config.slabs ?? 1) + delta));
    updateConfig({ slabs: next });
  };

  const setTargetValue = (key: string, slab: number, value: number) => {
    setTargetValues((prev) => {
      const row = { ...(prev[key] ?? {}) };
      row[slab] = value;
      return { ...prev, [key]: row };
    });
  };

  const handleUpload = async (file: File) => {
    if (!file || !houseId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("slab", String(uploadSlab));
      const res = await apiClient.post("/ga-report-builder/targets/preview", fd, {
        params: { house_id: houseId },
        headers: { "Content-Type": "multipart/form-data" },
      });
      const d = res.data?.data;
      setUploadRows(d?.rows ?? []);
      setUploadSummary({ total: d?.total ?? 0, matched: d?.matched ?? 0, invalid: d?.invalid ?? 0 });
      const entries: TargetEntry[] = [];
      for (const r of (d?.rows ?? []) as Array<{ retailer_code: string; target_value: number | null; valid_retailer: boolean; valid_target: boolean }>) {
        if (r.valid_retailer && r.target_value != null) {
          entries.push({ retailer_code: r.retailer_code, slab: uploadSlab, target_value: r.target_value });
        }
      }
      setUploadedTargets(entries);
    } catch (e) {
      toast.error((e as Error).message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const clearUpload = () => {
    setUploadRows([]);
    setUploadSummary(null);
    setUploadedTargets([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const buildTargetEntries = (): TargetEntry[] => {
    const entries: TargetEntry[] = [];
    const type = config.target_type ?? "retailer";
    const slabs = config.slabs ?? 1;
    if (type === "retailer") {
      entries.push(...uploadedTargets);
      return entries;
    }
    const ids = type === "rso" ? (config.rso_ids ?? []) : (config.bp_ids ?? []);
    for (const id of ids) {
      const row = targetValues[String(id)] ?? {};
      for (let s = 1; s <= slabs; s++) {
        if (row[s] && row[s] > 0) {
          entries.push({ entity_id: id, slab: s, target_value: row[s] });
        }
      }
    }
    return entries;
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
      const body = {
        name: name.trim(),
        start_date: start,
        end_date: end,
        description: description || null,
        config: {
          target_type: config.target_type ?? "retailer",
          retailer_codes: config.retailer_codes ?? [],
          rso_ids: config.rso_ids ?? [],
          bp_ids: config.bp_ids ?? [],
          slabs: config.slabs ?? 1,
          columns: (config.columns && config.columns.length > 0) ? config.columns : defaultColumns(),
          filters: {
            exclude_product_codes: config.filters?.exclude_product_codes ?? [],
            exclude_retailer_tags: config.filters?.exclude_retailer_tags ?? [],
          },
          sort_by: config.sort_by ?? "retailer_code",
          sort_order: config.sort_order ?? "desc",
        },
        targets: {
          target_type: config.target_type ?? "retailer",
          entries: buildTargetEntries(),
        },
      };
      let savedId: number | null = null;
      if (editingId) {
        const res = await apiClient.patch(`/ga-report-builder/events/${editingId}`, body);
        savedId = res.data?.data?.id ?? editingId;
        toast.success(t("ga_report_builder.event.update_success"));
      } else {
        const res = await apiClient.post("/ga-report-builder/events", body, { params: { house_id: houseId } });
        savedId = res.data?.data?.id;
        toast.success(t("ga_report_builder.event.create_success"));
      }
      reset();
      if (savedId) onSaved(savedId);
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: EventItem) => {
    setDeleteTarget({ event: e, permanent: false });
  };

  const removePermanent = async (e: EventItem) => {
    setDeleteTarget({ event: e, permanent: true });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { event: e, permanent } = deleteTarget;
    setDeleting(true);
    try {
      if (permanent) {
        await apiClient.delete(`/ga-report-builder/events/${e.id}/permanent`);
        toast.success(t("ga_report_builder.event.delete_permanent_success"));
      } else {
        await apiClient.delete(`/ga-report-builder/events/${e.id}`);
        toast.success(t("ga_report_builder.event.delete_success"));
      }
      if (editingId === e.id) reset();
      setDeleteTarget(null);
      onSaved(e.id);
    } catch (err) {
      toast.error((err as Error).message || "Delete failed");
    } finally {
      setDeleting(false);
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
            {editingId ? (
              <Pencil className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            ) : canCreate ? (
              <Plus className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            ) : (
              <CalendarDays className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 dark:text-gray-100">
              {editingId
                ? t("ga_report_builder.event.edit")
                : canCreate
                  ? t("ga_report_builder.event.create")
                  : t("ga_report_builder.event.manage")}
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {editingId
                ? t("ga_report_builder.event.subtitle_edit")
                : canCreate
                  ? t("ga_report_builder.event.subtitle_create")
                  : t("ga_report_builder.event.subtitle_manage")}
            </p>
          </div>
          <button onClick={() => { reset(); onClose(); }} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* form */}
          {(canCreate || canEdit) && (
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

            {/* Report configuration */}
            <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-3">
                <SlidersHorizontal className="w-4 h-4 text-primary-500" />
                {t("ga_report_builder.builder.config_title")}
              </p>
              <div className="space-y-4">
                {/* Target type */}
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                    {t("ga_report_builder.target.type")}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["rso", "bp", "retailer"] as const).map((tp) => (
                      <button
                        key={tp}
                        type="button"
                        onClick={() => setTargetType(tp)}
                        className={cn(
                          "min-h-[44px] rounded-xl border text-sm font-medium transition-colors",
                          (config.target_type ?? "retailer") === tp
                            ? "bg-primary-600 border-primary-600 text-white"
                            : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                        )}
                      >
                        {t(`ga_report_builder.target.${tp}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Entity selection */}
                {(config.target_type ?? "retailer") === "retailer" && (
                  <EntitySelector
                    label={t("ga_report_builder.filters.retailers")}
                    items={modalEntityItems.retailer}
                    selectedIds={config.retailer_codes ?? []}
                    onChange={(ids) => updateConfig({ retailer_codes: ids.map(String) })}
                    placeholder={t("ga_report_builder.filters.retailer_placeholder")}
                    searchPlaceholder={t("ga_report_builder.filters.retailer_placeholder")}
                    emptyMessage={modalEntityLoading ? t("ga_report_builder.messages.loading") : t("ga_report_builder.filters.no_entities")}
                    noResultsMessage={t("ga_report_builder.filters.no_results")}
                    selectAllLabel={t("ga_report_builder.target.select_all")}
                    clearLabel={t("ga_report_builder.target.deselect_all")}
                  />
                )}

                {(config.target_type ?? "retailer") === "rso" && (
                  <EntitySelector
                    label={t("ga_report_builder.filters.rso")}
                    items={modalEntityItems.rso}
                    selectedIds={config.rso_ids ?? []}
                    onChange={(ids) => updateConfig({ rso_ids: ids.map(Number) })}
                    placeholder={t("ga_report_builder.filters.rso_placeholder")}
                    searchPlaceholder={t("ga_report_builder.filters.rso_placeholder")}
                    emptyMessage={modalEntityLoading ? t("ga_report_builder.messages.loading") : t("ga_report_builder.filters.no_entities")}
                    noResultsMessage={t("ga_report_builder.filters.no_results")}
                    selectAllLabel={t("ga_report_builder.target.select_all")}
                    clearLabel={t("ga_report_builder.target.deselect_all")}
                  />
                )}

                {(config.target_type ?? "retailer") === "bp" && (
                  <EntitySelector
                    label={t("ga_report_builder.filters.bp")}
                    items={modalEntityItems.bp}
                    selectedIds={config.bp_ids ?? []}
                    onChange={(ids) => updateConfig({ bp_ids: ids.map(Number) })}
                    placeholder={t("ga_report_builder.filters.bp_placeholder")}
                    searchPlaceholder={t("ga_report_builder.filters.bp_placeholder")}
                    emptyMessage={modalEntityLoading ? t("ga_report_builder.messages.loading") : t("ga_report_builder.filters.no_entities")}
                    noResultsMessage={t("ga_report_builder.filters.no_results")}
                    selectAllLabel={t("ga_report_builder.target.select_all")}
                    clearLabel={t("ga_report_builder.target.deselect_all")}
                  />
                )}

                {/* Slabs */}
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                    {t("ga_report_builder.target.slabs")}
                  </label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => adjustSlabs(-1)} className="w-[44px] h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300">
                      <Minus className="w-4 h-4 mx-auto" />
                    </button>
                    <span className="flex-1 text-center font-semibold text-gray-800 dark:text-gray-200">{config.slabs ?? 1}</span>
                    <button type="button" onClick={() => adjustSlabs(1)} className="w-[44px] h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300">
                      <Plus className="w-4 h-4 mx-auto" />
                    </button>
                  </div>
                </div>

                {/* RSO / BP target grid */}
                {(config.target_type === "rso" || config.target_type === "bp") && (
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                      {t("ga_report_builder.target.targets")}
                    </label>
                    {entityRows.length === 0 ? (
                      <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-3">
                        {t("ga_report_builder.target.no_selection")}
                      </p>
                    ) : (
                      <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 dark:bg-slate-800/60">
                              <th className="px-2 py-2 text-left font-semibold text-xs text-gray-500 dark:text-gray-400">
                                {config.target_type === "rso" ? t("ga_report_builder.filters.rso") : t("ga_report_builder.filters.bp")}
                              </th>
                              {Array.from({ length: config.slabs ?? 1 }).map((_, i) => (
                                <th key={i} className="px-2 py-2 text-left font-semibold text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                  {(config.slabs ?? 1) > 1
                                    ? `${t("ga_report_builder.slab.label", { number: i + 1 })} ${t("ga_report_builder.slab.target")}`
                                    : t("ga_report_builder.slab.target")}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                            {entityRows.map((e) => (
                              <tr key={e.id}>
                                <td className="px-2 py-1">
                                  <p className="font-medium text-gray-800 dark:text-gray-200">{e.name}</p>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{e.code}</p>
                                </td>
                                {Array.from({ length: config.slabs ?? 1 }).map((_, i) => (
                                  <td key={i} className="px-2 py-1">
                                    <input
                                      type="number"
                                      min="0"
                                      value={targetValues[String(e.id)]?.[i + 1] ?? ""}
                                      onChange={(ev) => setTargetValue(String(e.id), i + 1, Number(ev.target.value) || 0)}
                                      placeholder="0"
                                      className="w-24 min-h-[44px] px-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Retailer Excel upload */}
                {config.target_type === "retailer" && (
                  <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3 space-y-2">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block">
                      {t("ga_report_builder.target.upload_title")}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }}
                        className="flex-1 text-sm text-gray-500 dark:text-gray-400 file:mr-2 file:min-h-[44px] file:rounded-lg file:border-0 file:bg-primary-600 file:px-3 file:text-white file:text-sm file:font-medium hover:file:bg-primary-700"
                      />
                      <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{t("ga_report_builder.slab.label", { number: uploadSlab })}</label>
                      <input
                        type="number"
                        min="1"
                        value={uploadSlab}
                        onChange={(e) => setUploadSlab(Math.max(1, Number(e.target.value) || 1))}
                        className="w-16 min-h-[44px] px-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                      />
                    </div>
                    <p className="text-[11px] text-gray-400">{t("ga_report_builder.target.upload_hint")}</p>
                    {uploading && (
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <Loader2 className="w-4 h-4 animate-spin" /> {t("ga_report_builder.target.uploading")}
                      </div>
                    )}
                    {uploadSummary && (
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-gray-600 dark:text-gray-300">
                          {t("ga_report_builder.target.upload_summary", { total: uploadSummary.total, matched: uploadSummary.matched, invalid: uploadSummary.invalid })}
                        </span>
                        <button type="button" onClick={clearUpload} className="text-red-500 underline">
                          {t("ga_report_builder.target.clear")}
                        </button>
                      </div>
                    )}
                    {uploadRows.length > 0 && (
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-100 dark:border-slate-800 divide-y divide-gray-100 dark:divide-slate-800">
                        {uploadRows.map((r, i) => (
                          <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                            <span className="font-medium text-gray-700 dark:text-gray-300">{r.retailer_code}</span>
                            <span className={cn("tabular-nums", r.valid_target && r.valid_retailer ? "text-green-600" : "text-red-500")}>
                              {r.target_value ?? "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Retailer-only: columns, sort */}
                {config.target_type === "retailer" && (
                  <>
                    <ColumnPicker
                      allColumns={columnsMeta}
                      selected={config.columns ?? []}
                      onChange={(cols) => updateConfig({ columns: cols })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.filters.sort_by")}</label>
                        <select
                          value={config.sort_by ?? "retailer_code"}
                          onChange={(e) => updateConfig({ sort_by: e.target.value })}
                          className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                        >
                          {(config.columns ?? []).map((c) => (
                            <option key={c} value={c}>{columnLabel(c)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.filters.sort_order")}</label>
                        <select
                          value={config.sort_order ?? "desc"}
                          onChange={(e) => updateConfig({ sort_order: e.target.value })}
                          className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                        >
                          <option value="desc">{t("ga_report_builder.filters.desc")}</option>
                          <option value="asc">{t("ga_report_builder.filters.asc")}</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {/* Exclusions */}
                <div className="space-y-3">
                      <SearchableMulti
                        label={t("ga_report_builder.filters.exclude_products")}
                        placeholder={t("ga_report_builder.filters.exclude_products_placeholder")}
                        items={productCodes.map((code) => ({ id: 0, code, name: code, itop_number: "" }))}
                        selectedKeys={config.filters?.exclude_product_codes ?? []}
                        onToggle={productToggle}
                        onSearch={() => {}}
                        loading={false}
                        searchable={false}
                        displayField="code"
                        keyField="code"
                      />
                      <SearchableMulti
                        label={t("ga_report_builder.filters.exclude_tags")}
                        placeholder={t("ga_report_builder.filters.exclude_tags_placeholder")}
                        items={tags}
                        selectedKeys={config.filters?.exclude_retailer_tags ?? []}
                        onToggle={tagToggle}
                        onSearch={() => {}}
                        loading={false}
                        searchable={false}
                        displayField="name"
                        keyField="name"
                      />
                    </div>
              </div>
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
          )}

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
                    <p className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate flex items-center gap-1.5">
                      {isEventLocked(e) && <Lock className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                      <span className="truncate">{e.name}</span>
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {e.start_date} → {e.end_date}
                      {e.description ? ` · ${e.description}` : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => startEdit(e)}
                      disabled={isEventLocked(e)}
                      className={cn(
                        "p-2 rounded-lg border text-gray-500 dark:text-gray-400",
                        isEventLocked(e)
                          ? "opacity-40 cursor-not-allowed border-gray-200 dark:border-slate-700"
                          : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800"
                      )}
                      title={isEventLocked(e) ? t("ga_report_builder.event.locked") : "Edit"}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => remove(e)} className="p-2 rounded-lg border border-red-200 dark:border-red-500/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {canPermanentDelete && (
                    <button onClick={() => removePermanent(e)} className="relative p-2 rounded-lg border border-red-300 dark:border-red-500/60 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20" title="Delete Permanently">
                      <Trash2 className="w-4 h-4" />
                      <X className="w-3 h-3 absolute -bottom-0.5 -right-0.5 bg-white dark:bg-slate-900 rounded-full" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </motion.div>

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={deleteTarget?.permanent ? t("ga_report_builder.event.delete_permanent") : t("ga_report_builder.event.delete")}
        message={`${deleteTarget?.permanent ? t("ga_report_builder.event.delete_permanent_confirm") : t("ga_report_builder.event.delete_confirm")} "${deleteTarget?.event.name ?? ""}"`}
        confirmText={deleteTarget?.permanent ? t("ga_report_builder.event.delete_permanent") : t("ga_report_builder.event.delete")}
        type="danger"
        loading={deleting}
      />
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

  const slabRegex = /^slab_(\d+)_(\w+)$/;
  const totalSlabs = columns.reduce((max, c) => {
    const mm = c.match(slabRegex);
    return mm ? Math.max(max, Number(mm[1])) : max;
  }, 0);
  const label = (key: string) => {
    const m = key.match(slabRegex);
    if (m) {
      const metricKey = t(`ga_report_builder.slab.${m[2]}`);
      const metric = metricKey !== `ga_report_builder.slab.${m[2]}` ? metricKey : m[2];
      if (totalSlabs <= 1) return metric;
      if (m[2] === "target") return `${t("ga_report_builder.slab.label", { number: Number(m[1]) })} ${metric}`;
      return metric;
    }
    const translated = t(`ga_report_builder.columns.${key}`);
    return translated !== `ga_report_builder.columns.${key}` ? translated : (columnMeta[key]?.label ?? key);
  };
  const isPct = (key: string) => /^slab_\d+_achievement_pct$/.test(key);
  const fmt = (key: string, val: string | number) => {
    if (isPct(key)) {
      const n = Number(val);
      return Number.isNaN(n) ? "—" : `${n.toLocaleString()}%`;
    }
    if (isNum(key)) return Number(val).toLocaleString();
    return String(val ?? "—");
  };
  const isNum = (key: string) => key === "live_activation" || slabRegex.test(key) || columnMeta[key]?.type === "number";

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
          const primaryKey = columns.find((c) => c === "retailer_name" || c === "retailer_code" || c === "rso_name" || c === "bp_name") ?? columns[0];
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

  const [rsoItems, setRsoItems] = useState<EntityOption[]>([]);
  const [rsoLoading, setRsoLoading] = useState(false);
  const [bpItems, setBpItems] = useState<EntityOption[]>([]);
  const [bpLoading, setBpLoading] = useState(false);
  const [configEntityItems, setConfigEntityItems] = useState<Record<"rso" | "bp" | "retailer", SelectorItem[]>>({
    rso: [], bp: [], retailer: [],
  });
  const [configEntityLoading, setConfigEntityLoading] = useState(false);

  const [payload, setPayload] = useState<Payload>(emptyPayload());
  const [report, setReport] = useState<ReportData | null>(null);
  const [building, setBuilding] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const payloadRef = useRef(payload);
  useEffect(() => { payloadRef.current = payload; }, [payload]);
  const appliedPersistableRef = useRef<string | null>(null);

  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [quickDeleteTarget, setQuickDeleteTarget] = useState<EventItem | null>(null);
  const [quickDeleting, setQuickDeleting] = useState(false);

  const canCreate = hasPermission("ga_report_builder.create");
  const canEdit = hasPermission("ga_report_builder.edit");
  const canDelete = hasPermission("ga_report_builder.delete");
  const canPermanentDelete = hasPermission("ga_report_builder.delete.permanent");
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

  const columnLabel = (key: string) => {
    const translated = t(`ga_report_builder.columns.${key}`);
    return translated !== `ga_report_builder.columns.${key}` ? translated : (columnMeta[key]?.label ?? key);
  };

  const configEntityRows = useMemo(() => {
    const type = payload.target_type ?? "retailer";
    const map = new Map<number, { id: number; name: string; code: string }>();
    if (type === "rso") {
      for (const s of configEntityItems.rso) map.set(Number(s.id), { id: Number(s.id), name: s.label, code: s.sublabel ?? "" });
      return (payload.rso_ids ?? []).map((id) => map.get(id)).filter((x): x is { id: number; name: string; code: string } => Boolean(x));
    }
    if (type === "bp") {
      for (const s of configEntityItems.bp) map.set(Number(s.id), { id: Number(s.id), name: s.label, code: s.sublabel ?? "" });
      return (payload.bp_ids ?? []).map((id) => map.get(id)).filter((x): x is { id: number; name: string; code: string } => Boolean(x));
    }
    return [];
  }, [payload.target_type, payload.rso_ids, payload.bp_ids, configEntityItems]);

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

  const loadEvents = useCallback(async (houseId: number | null): Promise<EventItem[]> => {
    if (!houseId) return [];
    try {
      const res = await apiClient.get("/ga-report-builder/events", { params: { house_id: houseId } });
      const list = (res.data?.data ?? []) as EventItem[];
      setEvents(list);
      return list;
    } catch {
      return [];
    }
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

  const buildReport = useCallback(async (p?: Payload) => {
    const target = p ?? payloadRef.current;
    if (!effectiveHouseId) {
      toast.error("Select a house first");
      return;
    }
    if (!target.start_date || !target.end_date) {
      toast.error("Select an event or pick a date range");
      return;
    }
    if (target.start_date > target.end_date) {
      toast.error("Start date cannot be after end date");
      return;
    }
    setBuilding(true);
    try {
      const body = { ...target, house_id: effectiveHouseId };
      const res = await apiClient.post("/ga-report-builder/report", body);
      setReport(res.data?.data ?? null);
      setConfigOpen(false);
      if (target.event_id && canEdit && persistableKey(target) !== appliedPersistableRef.current) {
        try {
          await apiClient.patch(`/ga-report-builder/events/${target.event_id}`, {
            config: {
              target_type: target.target_type,
              retailer_codes: target.retailer_codes,
              rso_ids: target.rso_ids,
              bp_ids: target.bp_ids,
              slabs: target.slabs,
              columns: target.columns,
              filters: target.filters,
              sort_by: target.sort_by,
              sort_order: target.sort_order,
            },
            targets: {
              target_type: target.target_type,
              entries: target.targets,
            },
          });
          appliedPersistableRef.current = persistableKey(target);
          await loadEvents(effectiveHouseId);
          toast.success(t("ga_report_builder.event.update_success"));
        } catch (e) {
          toast.error((e as Error).message || t("ga_report_builder.messages.build_error"));
        }
      }
    } catch (e) {
      toast.error((e as Error).message || t("ga_report_builder.messages.build_error"));
    } finally {
      setBuilding(false);
    }
  }, [effectiveHouseId, t, canEdit, loadEvents]);

  const eventToPayload = useCallback((ev: EventItem): Payload => {
    const cfg = (ev.config ?? {}) as Partial<Payload>;
    return {
      event_id: ev.id,
      start_date: ev.start_date,
      end_date: ev.end_date,
      target_type: cfg.target_type ?? "retailer",
      retailer_codes: cfg.retailer_codes ?? [],
      rso_ids: cfg.rso_ids ?? [],
      bp_ids: cfg.bp_ids ?? [],
      slabs: cfg.slabs && cfg.slabs > 0 ? cfg.slabs : 1,
      columns: (cfg.columns && cfg.columns.length > 0) ? cfg.columns : defaultColumns(),
      filters: {
        exclude_product_codes: cfg.filters?.exclude_product_codes ?? [],
        exclude_retailer_tags: cfg.filters?.exclude_retailer_tags ?? [],
      },
      sort_by: cfg.sort_by ?? "retailer_code",
      sort_order: cfg.sort_order ?? "desc",
      targets: [],
    };
  }, []);

  const applyEvent = useCallback(async (ev: EventItem, autoBuild = true) => {
    const next = eventToPayload(ev);
    try {
      const res = await apiClient.get(`/ga-report-builder/events/${ev.id}/targets`);
      const list = (res.data?.data ?? []) as Array<{
        target_type: string;
        entity_id: number | null;
        retailer_code: string | null;
        slab: number;
        target_value: number;
      }>;
      const entries: TargetEntry[] = [];
      for (const it of list) {
        if (it.target_type !== (next.target_type ?? "retailer")) continue;
        if (it.retailer_code) {
          entries.push({ retailer_code: it.retailer_code, slab: it.slab, target_value: it.target_value });
        } else if (it.entity_id != null) {
          entries.push({ entity_id: it.entity_id, slab: it.slab, target_value: it.target_value });
        }
      }
      next.targets = entries;
    } catch {
      /* event targets are optional (backend falls back to event rows) */
    }
    appliedPersistableRef.current = persistableKey(next);
    setPayload(next);
    if (autoBuild) {
      await buildReport(next);
    }
  }, [eventToPayload, buildReport]);

  useEffect(() => {
    if (!effectiveHouseId) return;
    setPayload((p) => ({ ...emptyPayload(), columns: p.columns }));
    loadEvents(effectiveHouseId).then((list) => {
      if (list.length > 0) void applyEvent(list[0], true);
    });
    loadTemplates(effectiveHouseId);
    loadExclusions(effectiveHouseId);
    setReport(null);
  }, [effectiveHouseId, loadEvents, loadTemplates, loadExclusions, applyEvent]);

  /* ── entity search ── */
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

  const searchBps = useCallback(async (q: string) => {
    if (!effectiveHouseId) return;
    setBpLoading(true);
    try {
      const res = await apiClient.get("/ga-report-builder/entities", {
        params: { entity_type: "bp", search: q || undefined, house_id: effectiveHouseId },
      });
      setBpItems(res.data?.data ?? []);
    } catch { /* silent */ } finally {
      setBpLoading(false);
    }
  }, [effectiveHouseId]);

  const fetchAllEntities = useCallback(async (type: "rso" | "bp" | "retailer"): Promise<EntityOption[]> => {
    if (!effectiveHouseId) return [];
    try {
      const res = await apiClient.get("/ga-report-builder/entities", {
        params: { entity_type: type, limit: 5000, house_id: effectiveHouseId },
      });
      return res.data?.data ?? [];
    } catch {
      return [];
    }
  }, [effectiveHouseId]);

  const loadConfigEntities = useCallback(async (type: "rso" | "bp" | "retailer") => {
    setConfigEntityLoading(true);
    try {
      const all = await fetchAllEntities(type);
      const items: SelectorItem[] = type === "retailer"
        ? all.map((i) => ({ id: i.code, label: i.code, sublabel: i.name }))
        : type === "bp"
          ? all.map((i) => ({ id: i.id, label: i.name, sublabel: i.pool_number || i.code }))
          : all.map((i) => ({ id: i.id, label: i.name, sublabel: i.code }));
      setConfigEntityItems((prev) => ({ ...prev, [type]: items }));
    } catch { /* silent */ } finally {
      setConfigEntityLoading(false);
    }
  }, [fetchAllEntities]);

  useEffect(() => {
    if (configOpen && effectiveHouseId) {
      const type = (payload.target_type ?? "retailer") as "rso" | "bp" | "retailer";
      void loadConfigEntities(type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configOpen, effectiveHouseId, payload.target_type]);

  useEffect(() => {
    if (effectiveHouseId) {
      searchRsos("");
      searchBps("");
    }
  }, [effectiveHouseId, searchRsos, searchBps]);

  /* ── payload helpers ── */
  const updatePayload = (patch: Partial<Payload>) => setPayload((p) => ({ ...p, ...patch }));

  const selectEvent = (eventId: number | null) => {
    const ev = events.find((e) => e.id === eventId);
    if (ev) {
      void applyEvent(ev, false);
    } else {
      updatePayload({
        event_id: null,
        start_date: "",
        end_date: "",
      });
    }
  };

  const build = () => {
    void buildReport();
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
      target_type: cfg.target_type ?? "retailer",
      retailer_codes: cfg.retailer_codes ?? [],
      rso_ids: cfg.rso_ids ?? [],
      bp_ids: cfg.bp_ids ?? [],
      slabs: cfg.slabs && cfg.slabs > 0 ? cfg.slabs : 1,
      columns: (cfg.columns ?? defaultColumns()).length > 0 ? (cfg.columns ?? defaultColumns()) : defaultColumns(),
      filters: {
        exclude_product_codes: filters.exclude_product_codes ?? [],
        exclude_retailer_tags: filters.exclude_retailer_tags ?? [],
      },
      sort_by: cfg.sort_by ?? "retailer_code",
      sort_order: cfg.sort_order ?? "desc",
      targets: cfg.targets ?? [],
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

  const handleEventsSaved = async (savedEventId: number) => {
    const list = await loadEvents(effectiveHouseId);
    const ev = list.find((e) => e.id === savedEventId);
    if (ev) {
      void applyEvent(ev, true);
    } else if (list.length > 0) {
      void applyEvent(list[0], true);
    } else {
      setPayload((p) => ({ ...emptyPayload(), columns: p.columns }));
      setReport(null);
    }
  };

  const quickDeleteEvent = (ev: EventItem) => {
    setQuickDeleteTarget(ev);
  };

  const confirmQuickDelete = async () => {
    if (!quickDeleteTarget) return;
    setQuickDeleting(true);
    try {
      await apiClient.delete(`/ga-report-builder/events/${quickDeleteTarget.id}`);
      toast.success(t("ga_report_builder.event.delete_success"));
      const id = quickDeleteTarget.id;
      setQuickDeleteTarget(null);
      await handleEventsSaved(id);
    } catch (err) {
      toast.error((err as Error).message || "Delete failed");
    } finally {
      setQuickDeleting(false);
    }
  };

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
  const bpToggle = (id: number) => {
    updatePayload({
      bp_ids: payload.bp_ids.includes(id)
        ? payload.bp_ids.filter((x) => x !== id)
        : [...payload.bp_ids, id],
    });
  };
  const setPayloadTargetType = (type: "rso" | "bp" | "retailer") => {
    updatePayload({ target_type: type, targets: [] });
  };
  const adjustPayloadSlabs = (delta: number) => {
    updatePayload({ slabs: Math.min(10, Math.max(1, (payload.slabs ?? 1) + delta)) });
  };

  const setPayloadTargetValue = (key: number, slab: number, value: number | null) => {
    setPayload((p) => {
      const rest = p.targets.filter((t) => !(String(t.entity_id) === String(key) && t.slab === slab));
      if (value === null || Number.isNaN(value) || value <= 0) return { ...p, targets: rest };
      return { ...p, targets: [...rest, { entity_id: key, slab, target_value: value }] };
    });
  };

  const updateConfigIds = (type: "rso" | "bp" | "retailer", ids: Array<number | string>) => {
    setPayload((p) => {
      const oldIds = type === "rso" ? p.rso_ids : type === "bp" ? p.bp_ids : p.retailer_codes;
      const newKeys = new Set(ids.map(String));
      const removedKeys = new Set(oldIds.filter((x) => !newKeys.has(String(x))).map(String));
      const targets = p.targets.filter((t) => !removedKeys.has(String(t.entity_id ?? t.retailer_code ?? "")));
      const patch: Partial<Payload> = type === "rso"
        ? { rso_ids: ids.map(Number) }
        : type === "bp"
          ? { bp_ids: ids.map(Number) }
          : { retailer_codes: ids.map(String) };
      return { ...p, ...patch, targets };
    });
  };

  const tagToggle = (name: string) => {
    updatePayload({
      filters: {
        ...payload.filters,
        exclude_retailer_tags: payload.filters.exclude_retailer_tags.includes(name)
          ? payload.filters.exclude_retailer_tags.filter((x) => x !== name)
          : [...payload.filters.exclude_retailer_tags, name],
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
      </div>

      <HouseSelector houses={houses} selected={selectedHouseId} onSelect={setSelectedHouseId} loading={housesLoading} />

      {effectiveHouseId && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-primary-500" />
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t("ga_report_builder.event.section")}</p>
            {canCreate && (
              <button
                onClick={() => setEventModalOpen(true)}
                className="ml-auto flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl border border-dashed border-gray-300 dark:border-slate-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                <Plus className="w-4 h-4" /> {t("ga_report_builder.event.create")}
              </button>
            )}
            {(canEdit || canDelete) && !canCreate && (
              <button
                onClick={() => setEventModalOpen(true)}
                className="ml-auto flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl border border-gray-300 dark:border-slate-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                <CalendarDays className="w-4 h-4" /> {t("ga_report_builder.event.manage")}
              </button>
            )}
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-4 py-3">
              {t("ga_report_builder.event.no_events")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {events.map((ev) => (
                <div key={ev.id} className="flex items-center gap-1.5">
                  <button
                    onClick={() => void applyEvent(ev, true)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 min-h-[44px] rounded-xl border text-sm transition-colors",
                      payload.event_id === ev.id
                        ? "bg-primary-600 border-primary-600 text-white shadow-sm"
                        : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                    )}
                  >
                    <CalendarDays className={cn("w-4 h-4", payload.event_id === ev.id ? "text-white" : "text-primary-500")} />
                    <span className="font-medium">{ev.name}</span>
                    <span className={cn("text-[11px]", payload.event_id === ev.id ? "text-white/80" : "text-gray-400")}>
                      {ev.start_date} → {ev.end_date}
                    </span>
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => quickDeleteEvent(ev)}
                      className="p-2 rounded-xl border border-red-200 dark:border-red-500/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 shrink-0"
                      title={t("ga_report_builder.event.delete_confirm")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!effectiveHouseId ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Building2 className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">{t("ga_report_builder.filters.house")}</p>
        </div>
      ) : (
        /* ── Full-width Preview ── */
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
            <div className="flex flex-wrap items-center gap-2">
              {events.length > 0 && (
                <button
                  onClick={() => setConfigOpen(true)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl text-sm transition-colors",
                    report
                      ? "border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                      : "bg-primary-600 text-white font-semibold hover:bg-primary-700"
                  )}
                >
                  <SlidersHorizontal className="w-4 h-4" /> {t("ga_report_builder.builder.configure")}
                </button>
              )}
              {report && canExport && (
                <button
                  onClick={exportExcel}
                  className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                >
                  <FileSpreadsheet className="w-4 h-4" /> {t("ga_report_builder.builder.export_excel")}
                </button>
              )}
              {report && canSend && (
                <button
                  onClick={() => setWaModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                >
                  <MessageCircle className="w-4 h-4" /> {t("ga_report_builder.builder.whatsapp")}
                </button>
              )}
            </div>
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
            <ReportTable columns={report.columns.filter((c) => c !== "activation_count")} rows={report.rows} totals={report.totals} columnMeta={columnMeta} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ArrowUpDown className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
                {t("ga_report_builder.builder.empty_hint")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Report Configuration Modal ── */}
      {configOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 backdrop-blur-md p-4">
          <motion.div
            initial={{ scale: 0.96, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            className="w-full max-w-2xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-3xl border border-gray-200 dark:border-slate-700/80 shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                <SlidersHorizontal className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-gray-100">{t("ga_report_builder.builder.config_title")}</h3>
              </div>
              <button onClick={() => setConfigOpen(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div className="rounded-2xl border border-gray-200 dark:border-slate-700/60 p-4 space-y-4">

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

              {/* Target type */}
              <div className="mb-4">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.target.type")}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["rso", "bp", "retailer"] as const).map((tp) => (
                    <button
                      key={tp}
                      type="button"
                      onClick={() => setPayloadTargetType(tp)}
                      className={cn(
                        "min-h-[44px] rounded-xl border text-sm font-medium transition-colors",
                        (payload.target_type ?? "retailer") === tp
                          ? "bg-primary-600 border-primary-600 text-white"
                          : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                      )}
                    >
                      {t(`ga_report_builder.target.${tp}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Retailers */}
              {(payload.target_type ?? "retailer") === "retailer" && (
                <div className="mb-4">
                  <EntitySelector
                    label={t("ga_report_builder.filters.retailers")}
                    items={configEntityItems.retailer}
                    selectedIds={payload.retailer_codes}
                    onChange={(ids) => updateConfigIds("retailer", ids)}
                    placeholder={t("ga_report_builder.filters.retailer_placeholder")}
                    searchPlaceholder={t("ga_report_builder.filters.retailer_placeholder")}
                    emptyMessage={configEntityLoading ? t("ga_report_builder.messages.loading") : t("ga_report_builder.filters.no_entities")}
                    noResultsMessage={t("ga_report_builder.filters.no_results")}
                    selectAllLabel={t("ga_report_builder.target.select_all")}
                    clearLabel={t("ga_report_builder.target.deselect_all")}
                  />
                </div>
              )}

              {/* RSOs */}
              {(payload.target_type ?? "retailer") === "rso" && (
                <div className="mb-4">
                  <EntitySelector
                    label={t("ga_report_builder.filters.rso")}
                    items={configEntityItems.rso}
                    selectedIds={payload.rso_ids}
                    onChange={(ids) => updateConfigIds("rso", ids)}
                    placeholder={t("ga_report_builder.filters.rso_placeholder")}
                    searchPlaceholder={t("ga_report_builder.filters.rso_placeholder")}
                    emptyMessage={configEntityLoading ? t("ga_report_builder.messages.loading") : t("ga_report_builder.filters.no_entities")}
                    noResultsMessage={t("ga_report_builder.filters.no_results")}
                    selectAllLabel={t("ga_report_builder.target.select_all")}
                    clearLabel={t("ga_report_builder.target.deselect_all")}
                  />
                </div>
              )}

              {/* BPs */}
              {(payload.target_type ?? "retailer") === "bp" && (
                <div className="mb-4">
                  <EntitySelector
                    label={t("ga_report_builder.filters.bp")}
                    items={configEntityItems.bp}
                    selectedIds={payload.bp_ids}
                    onChange={(ids) => updateConfigIds("bp", ids)}
                    placeholder={t("ga_report_builder.filters.bp_placeholder")}
                    searchPlaceholder={t("ga_report_builder.filters.bp_placeholder")}
                    emptyMessage={configEntityLoading ? t("ga_report_builder.messages.loading") : t("ga_report_builder.filters.no_entities")}
                    noResultsMessage={t("ga_report_builder.filters.no_results")}
                    selectAllLabel={t("ga_report_builder.target.select_all")}
                    clearLabel={t("ga_report_builder.target.deselect_all")}
                  />
                </div>
              )}

              {/* Slabs */}
              <div className="mb-4">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.target.slabs")}</label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => adjustPayloadSlabs(-1)} className="w-[44px] h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300">
                    <Minus className="w-4 h-4 mx-auto" />
                  </button>
                  <span className="flex-1 text-center font-semibold text-gray-800 dark:text-gray-200">{payload.slabs ?? 1}</span>
                  <button type="button" onClick={() => adjustPayloadSlabs(1)} className="w-[44px] h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300">
                    <Plus className="w-4 h-4 mx-auto" />
                  </button>
                </div>
              </div>

              {/* Targets */}
              {(payload.target_type ?? "retailer") !== "retailer" && (
                <div className="mb-4">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.target.targets")}</label>
                  {configEntityRows.length === 0 ? (
                    <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-3">
                      {t("ga_report_builder.target.no_selection")}
                    </p>
                  ) : (
                    <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-slate-800/60">
                            <th className="px-2 py-2 text-left font-semibold text-xs text-gray-500 dark:text-gray-400">
                              {(payload.target_type ?? "retailer") === "rso" ? t("ga_report_builder.filters.rso") : t("ga_report_builder.filters.bp")}
                            </th>
                            {Array.from({ length: payload.slabs ?? 1 }).map((_, i) => (
                              <th key={i} className="px-2 py-2 text-left font-semibold text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                {(payload.slabs ?? 1) > 1
                                  ? `${t("ga_report_builder.slab.label", { number: i + 1 })} ${t("ga_report_builder.slab.target")}`
                                  : t("ga_report_builder.slab.target")}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                          {configEntityRows.map((e) => (
                            <tr key={e.id}>
                              <td className="px-2 py-1">
                                <p className="font-medium text-gray-800 dark:text-gray-200">{e.name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{e.code}</p>
                              </td>
                              {Array.from({ length: payload.slabs ?? 1 }).map((_, i) => {
                                const entry = payload.targets.find((te) => String(te.entity_id) === String(e.id) && te.slab === i + 1);
                                return (
                                  <td key={i} className="px-2 py-1">
                                    <input
                                      type="number"
                                      min="0"
                                      value={entry?.target_value ?? ""}
                                      onChange={(ev) => setPayloadTargetValue(e.id, i + 1, ev.target.value === "" ? null : Number(ev.target.value))}
                                      placeholder="0"
                                      className="w-24 min-h-[44px] px-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Columns */}
              {(payload.target_type ?? "retailer") === "retailer" && (
                <div className="mb-4">
                  <ColumnPicker allColumns={columnsMeta} selected={payload.columns} onChange={(cols) => updatePayload({ columns: cols })} />
                </div>
              )}

              {/* Sort */}
              {(payload.target_type ?? "retailer") === "retailer" && (
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("ga_report_builder.filters.sort_by")}</label>
                  <select
                    value={payload.sort_by}
                    onChange={(e) => updatePayload({ sort_by: e.target.value })}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                  >
                    {payload.columns.map((c) => (
                      <option key={c} value={c}>{columnLabel(c)}</option>
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
              )}

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
                  keyField="code"
                />
                <SearchableMulti
                  label={t("ga_report_builder.filters.exclude_tags")}
                  placeholder={t("ga_report_builder.filters.exclude_tags_placeholder")}
                  items={tags}
                  selectedKeys={payload.filters.exclude_retailer_tags}
                  onToggle={tagToggle}
                  onSearch={() => {}}
                  loading={false}
                  searchable={false}
                  displayField="name"
                  keyField="name"
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
          </motion.div>
        </div>
      )}

      <EventManagerModal
        open={eventModalOpen}
        onClose={() => setEventModalOpen(false)}
        houseId={effectiveHouseId}
        events={events}
        onSaved={handleEventsSaved}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canPermanentDelete={canPermanentDelete}
        columnsMeta={columnsMeta}
        rsoItems={rsoItems}
        bpItems={bpItems}
        fetchAllEntities={fetchAllEntities}
        productCodes={productCodes}
        tags={tags}
      />
      <ConfirmationModal
        isOpen={!!quickDeleteTarget}
        onClose={() => setQuickDeleteTarget(null)}
        onConfirm={confirmQuickDelete}
        title={t("ga_report_builder.event.delete")}
        message={`${t("ga_report_builder.event.delete_confirm")} "${quickDeleteTarget?.name ?? ""}"`}
        confirmText={t("ga_report_builder.event.delete")}
        type="danger"
        loading={quickDeleting}
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
