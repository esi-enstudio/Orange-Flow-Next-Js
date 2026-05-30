"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Tag,
  Plus,
  X,
  Search,
  Loader2,
  Check,
  Store,
  Trash2,
  UserCheck,
  Hash,
  Smartphone,
  Home
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { useLanguage } from "@/i18n/useLanguage";

interface House {
  id: number;
  name: string;
  code: string;
}

interface FilterTag {
  id: number;
  house_id: number;
  name: string;
}

interface Retailer {
  id: number;
  name: string;
  retailer_code: string;
  itop_number: string;
  thana: string;
  type: string;
  employee?: { name: string; itop_number: string } | null;
}

interface RetailerFilter {
  id: number;
  house_id: number;
  retailer_id: number;
  tag: string;
  retailer: Retailer | null;
}

export default function RetailerMarkingPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [tags, setTags] = useState<FilterTag[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<number | "">("");
  const [selectedTag, setSelectedTag] = useState<string | "">("");
  const [retailerFilters, setRetailerFilters] = useState<RetailerFilter[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Retailer[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagHouseId, setNewTagHouseId] = useState<number | "">("");
  const [creatingTag, setCreatingTag] = useState(false);
  const [activeTab, setActiveTab] = useState<"tags" | "marking">("tags");
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("view_retailers")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchHouses = useCallback(async () => {
    try {
      const res = await apiClient.get("houses");
      setHouses(res.data);
    } catch {
      // silently fail
    }
  }, []);

  const fetchTags = useCallback(async (houseId?: number | string) => {
    try {
      const params: Record<string, any> = {};
      if (houseId) params.house_id = houseId;
      const res = await apiClient.get("filter-tags", { params });
      setTags(res.data);
    } catch {
      toast.error(t('retailer_marking.toast_load_failed'));
    }
  }, [t]);

  const fetchMarkedRetailers = useCallback(async (tag: string) => {
    if (!tag) {
      setRetailerFilters([]);
      return;
    }
    try {
      const res = await apiClient.get("retailer-filters", { params: { tag } });
      setRetailerFilters(res.data);
    } catch {
      toast.error(t('retailer_marking.toast_load_failed'));
    }
  }, [t]);

  const searchRetailers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const res = await apiClient.get("retailers", { params: { search: query.trim(), limit: 100 } });
      setSearchResults(res.data);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    searchTimer.current = setTimeout(() => searchRetailers(search), 200);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, searchRetailers]);

  useEffect(() => {
    if (!authLoading && hasPermission("view_retailers")) {
      setLoading(true);
      Promise.all([fetchTags(), fetchHouses()]).finally(() => setLoading(false));
    }
  }, [authLoading, hasPermission, fetchTags, fetchHouses]);

  useEffect(() => {
    fetchTags(selectedHouseId || undefined);
  }, [selectedHouseId, fetchTags]);

  useEffect(() => {
    if (selectedTag) {
      fetchMarkedRetailers(selectedTag);
      setSearch("");
      setSearchResults([]);
      setSelectedIds(new Set());
    }
  }, [selectedTag, fetchMarkedRetailers]);

  useEffect(() => {
    if (tags.length > 0 && !selectedTag) {
      setSelectedTag(tags[0].name);
    }
  }, [tags]);

  const handleCreateTag = async () => {
    if (!newTagName.trim() || !newTagHouseId) return;
    setCreatingTag(true);
    try {
      await apiClient.post("filter-tags", { name: newTagName.trim(), house_id: Number(newTagHouseId) });
      toast.success(t('retailer_marking.toast_tag_created'));
      setNewTagName("");
      setNewTagHouseId("");
      setShowAddTag(false);
      await fetchTags(selectedHouseId || undefined);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t('retailer_marking.toast_apply_failed'));
    } finally {
      setCreatingTag(false);
    }
  };

  const handleDeleteTag = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await apiClient.delete(`filter-tags/${deleteConfirm.id}`);
      toast.success(t('retailer_marking.toast_tag_deleted'));
      if (selectedTag) {
        const deletedTag = tags.find(t => t.id === deleteConfirm.id);
        if (deletedTag?.name === selectedTag) setSelectedTag("");
      }
      await fetchTags(selectedHouseId || undefined);
      setDeleteConfirm(null);
    } catch {
      toast.error(t('retailer_marking.toast_apply_failed'));
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkApply = async () => {
    if (!selectedTag || selectedIds.size === 0) return;
    setApplying(true);
    try {
      const res = await apiClient.post("retailer-filters/bulk", {
        retailer_ids: Array.from(selectedIds),
        tag: selectedTag
      });
      toast.success(t('retailer_marking.bulk_success', { count: res.data.count }));
      setSelectedIds(new Set());
      await fetchMarkedRetailers(selectedTag);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t('retailer_marking.toast_apply_failed'));
    } finally {
      setApplying(false);
    }
  };

  const handleRemoveTag = async (filterId: number) => {
    try {
      await apiClient.delete(`retailer-filters/${filterId}`);
      toast.success(t('retailer_marking.toast_tag_removed'));
      await fetchMarkedRetailers(selectedTag);
    } catch {
      toast.error(t('retailer_marking.toast_apply_failed'));
    }
  };

  const markedRetailerIds = new Set(retailerFilters.map(f => f.retailer_id));
  const unmarkedResults = searchResults.filter(r => !markedRetailerIds.has(r.id));

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === unmarkedResults.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unmarkedResults.map(r => r.id)));
    }
  };

  if (!authLoading && !hasPermission("view_retailers")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('retailer_marking.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('retailer_marking.description')}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg">
            {t('retailer_marking.tags_count', { count: tags.length })}
          </span>
          <span className="text-xs font-bold text-primary-600 bg-primary-50 dark:bg-primary-500/10 px-3 py-1.5 rounded-lg">
            {t('retailer_marking.marked_count', { count: retailerFilters.length })}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab("tags")}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-bold transition-all",
            activeTab === "tags"
              ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 shadow-sm"
              : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          )}
        >
          {t('retailer_marking.manage_tags')}
        </button>
        <button
          onClick={() => setActiveTab("marking")}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-bold transition-all",
            activeTab === "marking"
              ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 shadow-sm"
              : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          )}
        >
          {t('retailer_marking.mark_retailers')}
        </button>
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
        </div>
      ) : activeTab === "tags" ? (
        /* === TAGS MANAGEMENT === */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-50 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 shrink-0">{t('retailer_marking.manage_tags')}</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setShowAddTag(true); if (selectedHouseId) setNewTagHouseId(selectedHouseId); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-bold hover:bg-primary-600 transition-colors shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('retailer_marking.add_tag')}
              </button>
            </div>
          </div>

          {showAddTag && (
            <div className="p-4 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="relative flex-1">
                  <Home className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <select
                    value={newTagHouseId}
                    onChange={e => setNewTagHouseId(e.target.value ? Number(e.target.value) : "")}
                    className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100 appearance-none cursor-pointer"
                  >
                    <option value="">{t('retailer_marking.select_house')}</option>
                    {houses.map(h => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  placeholder={t('retailer_marking.tag_name_placeholder')}
                  className="flex-[2] px-3 py-2 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100"
                  onKeyDown={e => e.key === 'Enter' && handleCreateTag()}
                  autoFocus
                />
                <button
                  onClick={handleCreateTag}
                  disabled={creatingTag || !newTagName.trim() || !newTagHouseId}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-bold hover:bg-primary-600 transition-colors disabled:opacity-50 shrink-0"
                >
                  {creatingTag ? <Loader2 className="w-4 h-4 animate-spin" /> : t('retailer_marking.create_tag')}
                </button>
                <button
                  onClick={() => { setShowAddTag(false); setNewTagName(""); setNewTagHouseId(""); }}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {tags.length === 0 ? (
            <div className="py-16 text-center">
              <Tag className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400 font-medium">{t('retailer_marking.no_tags')}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('retailer_marking.no_tags_hint')}</p>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tags.map(tag => {
                const tagHouse = houses.find(h => h.id === tag.house_id);
                return (
                  <div
                    key={tag.id}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer",
                      selectedTag === tag.name
                        ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10 dark:border-primary-500"
                        : "border-gray-100 dark:border-slate-700 hover:border-gray-200 dark:hover:border-slate-600"
                    )}
                    onClick={() => { setSelectedTag(tag.name); setActiveTab("marking"); }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                        selectedTag === tag.name ? "bg-primary-500 text-white" : "bg-gray-100 dark:bg-slate-700 text-gray-500"
                      )}>
                        <Tag className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-bold text-sm text-gray-900 dark:text-gray-100 block truncate">{tag.name}</span>
                        {tagHouse && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 block truncate">{tagHouse.name}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteConfirm({ id: tag.id, name: tag.name }); }}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* === RETAILER MARKING === */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Marked Retailers */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-50 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <select
                    value={selectedTag}
                    onChange={e => setSelectedTag(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100 appearance-none cursor-pointer"
                  >
                    <option value="">{t('retailer_marking.select_tag')}</option>
                    {tags.map(tag => (
                      <option key={tag.id} value={tag.name}>{tag.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {!selectedTag ? (
              <div className="py-16 text-center">
                <Tag className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 dark:text-gray-500 text-sm font-medium">{t('retailer_marking.select_tag')}</p>
              </div>
            ) : retailerFilters.length === 0 ? (
              <div className="py-16 text-center">
                <Store className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-gray-400 font-medium">{t('retailer_marking.no_marked')}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
                {retailerFilters.map(rf => (
                  <div key={rf.id} className="p-4 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors group">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 font-bold shrink-0">
                        <Store className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{rf.retailer?.name || `#${rf.retailer_id}`}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                          <span className="font-mono">{rf.retailer?.retailer_code}</span>
                          {rf.retailer?.itop_number && <><span className="mx-1.5 text-gray-300 dark:text-gray-600">|</span><span className="font-mono">{rf.retailer.itop_number}</span></>}
                          {rf.retailer?.employee?.name && (
                            <><span className="mx-1.5 text-gray-300 dark:text-gray-600">|</span>{rf.retailer.employee.name} ({rf.retailer.employee.itop_number?.slice(-3)})</>
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveTag(rf.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Unmarked Retailers */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-50 dark:border-slate-800 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder={t('retailer_marking.search_placeholder')}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setSelectedIds(new Set()); }}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === unmarkedResults.length && unmarkedResults.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 dark:border-slate-600 text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                    {selectedIds.size === unmarkedResults.length && unmarkedResults.length > 0
                      ? t('retailer_marking.deselect_all')
                      : t('retailer_marking.select_all')}
                  </span>
                </label>
                {selectedTag && selectedIds.size > 0 && (
                  <button
                    onClick={handleBulkApply}
                    disabled={applying}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-bold hover:bg-primary-600 transition-colors disabled:opacity-50"
                  >
                    {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {t('retailer_marking.apply_tag')} ({selectedIds.size})
                  </button>
                )}
              </div>
            </div>

            {!selectedTag ? (
              <div className="py-16 text-center">
                <Tag className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 dark:text-gray-500 text-sm font-medium">{t('retailer_marking.select_retailer')}</p>
              </div>
            ) : searching ? (
              <div className="py-16 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
              </div>
            ) : search && unmarkedResults.length === 0 ? (
              <div className="py-16 text-center">
                <UserCheck className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-gray-400 font-medium">{t('retailer_marking.no_marked')}</p>
              </div>
            ) : !search ? (
              <div className="py-16 text-center">
                <Search className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 dark:text-gray-500 text-sm font-medium">{t('common.search')}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
                {unmarkedResults.map(r => (
                  <div
                    key={r.id}
                    className={cn(
                      "p-4 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer",
                      selectedIds.has(r.id) && "bg-primary-50/50 dark:bg-primary-500/5"
                    )}
                    onClick={() => toggleSelect(r.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center font-bold shrink-0",
                        selectedIds.has(r.id)
                          ? "bg-primary-500 text-white"
                          : "bg-gray-100 dark:bg-slate-700 text-gray-500"
                      )}>
                        {selectedIds.has(r.id) ? <Check className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{r.name}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                          <span className="font-mono">{r.retailer_code}</span>
                          {r.itop_number && <><span className="mx-1.5 text-gray-300 dark:text-gray-600">|</span><span className="font-mono">{r.itop_number}</span></>}
                          {r.employee?.name && (
                            <><span className="mx-1.5 text-gray-300 dark:text-gray-600">|</span>{r.employee.name} ({r.employee.itop_number?.slice(-3)})</>
                          )}
                        </p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      className="rounded border-gray-300 dark:border-slate-600 text-primary-500 focus:ring-primary-500 shrink-0 ml-2"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmationModal
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteTag}
        title={t('common.delete') || "Delete Tag"}
        message={deleteConfirm ? `Are you sure you want to delete "${deleteConfirm.name}"? This will also remove the tag from all marked retailers.` : ""}
        confirmText={t('retailer_marking.delete_tag') || "Delete"}
        type="danger"
        loading={deleting}
      />
    </div>
  );
}
