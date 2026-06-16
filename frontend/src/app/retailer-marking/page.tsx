"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Tag, Plus, X, Search, Loader2, Check, Store, Trash2, UserCheck, Hash, Smartphone, Home, MapPin
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { useLanguage } from "@/i18n/useLanguage";

interface House {
  id: number; name: string; code: string;
}

interface FilterTag {
  id: number; house_id: number; name: string;
}

interface Retailer {
  id: number; name: string; retailer_code: string; itop_number: string;
  thana: string; type: string; employee?: { name: string; itop_number: string } | null;
}

interface RetailerFilter {
  id: number; house_id: number; retailer_id: number; tag_id: number;
  tag: string | null; retailer: Retailer | null;
}

export default function RetailerMarkingPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [tags, setTags] = useState<FilterTag[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<number | "">("");
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
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

  const selectedTagName = tags.find(t => t.id === selectedTagId)?.name || "";

  useEffect(() => {
    if (!authLoading && !hasPermission("retailers.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchHouses = useCallback(async () => {
    try { const res = await apiClient.get("houses"); setHouses(res.data); } catch {}
  }, []);

  const fetchTags = useCallback(async (houseId?: number | string) => {
    try {
      const params: Record<string, any> = {};
      if (houseId) params.house_id = houseId;
      const res = await apiClient.get("filter-tags", { params });
      setTags(res.data);
    } catch { toast.error(t('retailer_marking.toast_load_failed')); }
  }, [t]);

  const fetchMarkedRetailers = useCallback(async (tagName: string) => {
    if (!tagName) { setRetailerFilters([]); return; }
    try {
      const res = await apiClient.get("retailer-filters", { params: { tag: tagName } });
      setRetailerFilters(res.data);
    } catch { toast.error(t('retailer_marking.toast_load_failed')); }
  }, [t]);

  const searchRetailers = useCallback(async (query: string) => {
    if (!query.trim()) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    try {
      const res = await apiClient.get("retailers", { params: { search: query.trim(), per_page: 100 } });
      setSearchResults(res.data.data || res.data);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) { setSearchResults([]); setSearching(false); return; }
    searchTimer.current = setTimeout(() => searchRetailers(search), 200);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, searchRetailers]);

  useEffect(() => {
    if (!authLoading && hasPermission("retailers.view")) {
      setLoading(true);
      fetchHouses().finally(() => setLoading(false));
    }
  }, [authLoading, hasPermission, fetchHouses]);

  useEffect(() => {
    fetchTags(selectedHouseId || undefined);
  }, [selectedHouseId, fetchTags]);

  useEffect(() => {
    if (selectedTagId) {
      fetchMarkedRetailers(selectedTagName);
      setSearch(""); setSearchResults([]); setSelectedIds(new Set());
    }
  }, [selectedTagId, selectedTagName, fetchMarkedRetailers]);

  useEffect(() => {
    if (tags.length > 0 && !selectedTagId) {
      setSelectedTagId(tags[0].id);
    }
  }, [tags]);

  const handleCreateTag = async () => {
    if (!newTagName.trim() || !newTagHouseId) return;
    setCreatingTag(true);
    try {
      await apiClient.post("filter-tags", { name: newTagName.trim(), house_id: Number(newTagHouseId) });
      toast.success(t('retailer_marking.toast_tag_created'));
      setNewTagName(""); setNewTagHouseId(""); setShowAddTag(false);
      await fetchTags(selectedHouseId || undefined);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t('retailer_marking.toast_apply_failed'));
    } finally { setCreatingTag(false); }
  };

  const handleDeleteTag = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await apiClient.delete(`filter-tags/${deleteConfirm.id}`);
      toast.success(t('retailer_marking.toast_tag_deleted'));
      if (selectedTagId === deleteConfirm.id) setSelectedTagId(null);
      await fetchTags(selectedHouseId || undefined);
      setDeleteConfirm(null);
    } catch { toast.error(t('retailer_marking.toast_apply_failed')); }
    finally { setDeleting(false); }
  };

  const handleBulkApply = async () => {
    if (!selectedTagId || selectedIds.size === 0) return;
    setApplying(true);
    try {
      const res = await apiClient.post("retailer-filters/bulk", {
        retailer_ids: Array.from(selectedIds), tag_id: selectedTagId
      });
      toast.success(t('retailer_marking.bulk_success', { count: res.data.count }));
      setSelectedIds(new Set());
      await fetchMarkedRetailers(selectedTagName);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t('retailer_marking.toast_apply_failed'));
    } finally { setApplying(false); }
  };

  const handleRemoveTag = async (filterId: number) => {
    try {
      await apiClient.delete(`retailer-filters/${filterId}`);
      toast.success(t('retailer_marking.toast_tag_removed'));
      await fetchMarkedRetailers(selectedTagName);
    } catch { toast.error(t('retailer_marking.toast_apply_failed')); }
  };

  const markedRetailerIds = new Set(retailerFilters.map(f => f.retailer_id));
  const unmarkedResults = searchResults.filter(r => !markedRetailerIds.has(r.id));

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === unmarkedResults.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(unmarkedResults.map(r => r.id)));
  };

  if (authLoading) return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-8 h-8 animate-spin text-primary-500" /></div>;
  if (!hasPermission("retailers.view")) return <AccessDenied />;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{t('retailer_marking.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('retailer_marking.description')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-1.5 w-fit">
        <button onClick={() => setActiveTab("tags")}
          className={cn("px-5 py-2.5 text-sm font-semibold rounded-xl transition-all",
            activeTab === "tags" ? "bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200")}>
          {t('retailer_marking.manage_tags')}
        </button>
        <button onClick={() => setActiveTab("marking")}
          className={cn("px-5 py-2.5 text-sm font-semibold rounded-xl transition-all",
            activeTab === "marking" ? "bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200")}>
          {t('retailer_marking.mark_retailers')}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary-500" /></div>
      ) : activeTab === "tags" ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
          <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold flex items-center gap-2 dark:text-gray-100">
              <Tag className="w-5 h-5 text-primary-600" /> {t('retailer_marking.manage_tags')}
              <span className="text-xs font-bold bg-primary-50 dark:bg-primary-500/10 text-primary-600 px-2 py-0.5 rounded-full">{tags.length}</span>
            </h2>
            <div className="flex items-center gap-3">
              <select value={selectedHouseId} onChange={e => setSelectedHouseId(e.target.value ? Number(e.target.value) : "")}
                className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none">
                <option value="">{t('retailer_marking.filter_by_house')}</option>
                {houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
              <button onClick={() => setShowAddTag(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors shadow-lg shadow-primary-100">
                <Plus className="w-4 h-4" /> {t('retailer_marking.add_tag')}
              </button>
            </div>
          </div>

          {showAddTag && (
            <div className="p-6 border-b border-gray-50 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('retailer_marking.select_house')}</label>
                  <select value={newTagHouseId} onChange={e => setNewTagHouseId(e.target.value ? Number(e.target.value) : "")}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none">
                    <option value="">{t('retailer_marking.select_house')}</option>
                    {houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('retailer_marking.tag_name')}</label>
                  <input type="text" value={newTagName} onChange={e => setNewTagName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCreateTag()}
                    placeholder={t('retailer_marking.tag_name_placeholder')}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
                <button onClick={handleCreateTag} disabled={creatingTag || !newTagName.trim() || !newTagHouseId}
                  className="px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors flex items-center gap-2">
                  {creatingTag ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {t('retailer_marking.create_tag')}
                </button>
              </div>
            </div>
          )}

          {tags.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-14 h-14 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4"><Tag className="w-7 h-7 text-gray-300 dark:text-gray-600" /></div>
              <p className="font-medium text-gray-900 dark:text-gray-100">{t('retailer_marking.no_tags')}</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{t('retailer_marking.no_tags_hint')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-6">
              {tags.map(tag => (
                <div key={tag.id}
                  onClick={() => { setSelectedTagId(tag.id); setActiveTab("marking"); }}
                  className={cn("flex items-center justify-between p-4 rounded-2xl border-2 cursor-pointer transition-all",
                    selectedTagId === tag.id
                      ? "border-primary-500 bg-primary-50/50 dark:bg-primary-500/5 dark:border-primary-500"
                      : "border-gray-100 dark:border-slate-700 hover:border-gray-200 dark:hover:border-slate-600 hover:shadow-sm bg-white dark:bg-slate-900")}>
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center",
                      selectedTagId === tag.id ? "bg-primary-500 text-white" : "bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-gray-500")}>
                      <Hash className="w-5 h-5" />
                    </div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{tag.name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{houses.find(h => h.id === tag.house_id)?.code || "—"}</p>
                  </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setDeleteConfirm({ id: tag.id, name: tag.name }); }}
                    className="p-2 rounded-xl text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Marked retailers */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
            <div className="p-6 border-b border-gray-50 dark:border-slate-800">
              <h2 className="font-bold flex items-center gap-2 dark:text-gray-100 mb-3">
                <Tag className="w-5 h-5 text-primary-600" /> {t('retailer_marking.mark_retailers')}
              </h2>
              <select value={selectedTagId ?? ""} onChange={e => setSelectedTagId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none">
                <option value="">{t('retailer_marking.select_tag')}</option>
                {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-slate-800 max-h-[500px] overflow-y-auto">
              {retailerFilters.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-gray-400 dark:text-gray-500">{t('retailer_marking.no_marked')}</p>
                </div>
              ) : retailerFilters.map(rf => (
                <div key={rf.id} className="flex items-center gap-3 px-6 py-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center flex-shrink-0">
                    <Store className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{rf.retailer?.name}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      <span>{rf.retailer?.retailer_code}</span>
                      {rf.retailer?.itop_number && <><span className="w-1 h-1 rounded-full bg-gray-300" /><span>{rf.retailer.itop_number}</span></>}
                      {rf.retailer?.thana && <><span className="w-1 h-1 rounded-full bg-gray-300" /><span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{rf.retailer.thana}</span></>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {rf.retailer?.employee?.name && <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" />{rf.retailer.employee.name}{rf.retailer.employee.itop_number ? ` (${rf.retailer.employee.itop_number.slice(-3)})` : ""}</span>}
                    </div>
                  </div>
                  <button onClick={() => handleRemoveTag(rf.id)}
                    className="p-2 rounded-xl text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all" title={t('retailer_marking.remove_tag')}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {retailerFilters.length > 0 && (
                <div className="px-6 py-3 bg-gray-50/50 dark:bg-slate-800/30">
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t('retailer_marking.marked_count', { count: retailerFilters.length })}</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Search & apply */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
            <div className="p-6 border-b border-gray-50 dark:border-slate-800">
              <h2 className="font-bold flex items-center gap-2 dark:text-gray-100 mb-3">
                <Plus className="w-5 h-5 text-primary-600" /> {t('retailer_marking.select_retailer')}
              </h2>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={t('retailer_marking.search_retailers')}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none" />
              </div>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-slate-800 max-h-[500px] overflow-y-auto">
              {!search.trim() ? (
                <div className="p-8 text-center"><p className="text-sm text-gray-400">{t('retailer_marking.search_retailers')}</p></div>
              ) : searching ? (
                <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-primary-500 mx-auto" /></div>
              ) : unmarkedResults.length === 0 ? (
                <div className="p-8 text-center"><p className="text-sm text-gray-400">No retailers found</p></div>
              ) : unmarkedResults.map(r => (
                <div key={r.id} onClick={() => toggleSelect(r.id)}
                  className={cn("flex items-center gap-3 px-6 py-4 cursor-pointer transition-colors",
                    selectedIds.has(r.id) ? "bg-primary-50/50 dark:bg-primary-500/5" : "hover:bg-gray-50/50 dark:hover:bg-slate-800/50")}>
                  <div className={cn("w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                    selectedIds.has(r.id) ? "bg-primary-600 border-primary-600" : "border-gray-300 dark:border-gray-600")}>
                    {selectedIds.has(r.id) && <Check className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
                    <Store className="w-5 h-5 text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{r.name}</p>
                    <p className="text-xs text-gray-400 truncate">{r.retailer_code} · {r.itop_number || "—"}</p>
                  </div>
                </div>
              ))}
            </div>
            {unmarkedResults.length > 0 && (
              <div className="p-4 border-t border-gray-50 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <button onClick={toggleSelectAll} className="text-primary-600 dark:text-primary-400 font-semibold hover:underline">
                    {selectedIds.size === unmarkedResults.length ? t('retailer_marking.deselect_all') : t('retailer_marking.select_all')}
                  </button>
                  <span className="text-gray-400">{selectedIds.size} selected</span>
                </div>
                <button onClick={handleBulkApply} disabled={!selectedTagId || selectedIds.size === 0 || applying}
                  className="w-full py-3 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
                  {t('retailer_marking.apply_tag')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmationModal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteTag} title={t('retailer_marking.delete_tag')}
        message={`${t('common.confirm_delete_desc')} "${deleteConfirm?.name}"?`}
        confirmText={t('retailer_marking.delete_tag')} type="danger" loading={deleting} />
    </div>
  );
}
