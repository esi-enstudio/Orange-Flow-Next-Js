"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Plus, Home, SlidersHorizontal, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";
import HouseMasterFilter from "@/components/houses/HouseMasterFilter";
import type { HouseFilters } from "@/types/house";
import { defaultFilters } from "@/types/house";
import HouseCard from "./_components/HouseCard";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import HouseFormModal from "./_components/HouseFormModal";


interface House {
  id: number;
  name: string;
  code: string;
  cluster: string;
  region: string;
  wh_region: string;
  district: string;
  email: string;
  address: string;
  proprietor_name: string;
  proprietor_contact: string;
  poc_name: string;
  poc_mobile: string;
  lifting_date: string;
  latitude: string;
  longitude: string;
  bts_id: string;
  dms_user: string;
  dms_pass: string;
  dms_house_id: string;
  is_active: boolean;
}

export default function HousesPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<HouseFilters>({ ...defaultFilters });

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [editingHouse, setEditingHouse] = useState<House | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    code: "",
    cluster: "",
    region: "",
    wh_region: "",
    district: "",
    email: "",
    address: "",
    proprietor_name: "",
    proprietor_contact: "",
    poc_name: "",
    poc_mobile: "",
    lifting_date: "",
    latitude: "",
    longitude: "",
    bts_id: "",
    dms_user: "",
    dms_pass: "",
    dms_house_id: "",
    is_active: true
  });

  const openAddModal = () => {
    setEditingHouse(null);
    setFormData({
      name: "", code: "", cluster: "", region: "", wh_region: "", district: "",
      email: "", address: "", proprietor_name: "", proprietor_contact: "",
      poc_name: "", poc_mobile: "", lifting_date: "", latitude: "", longitude: "",
      bts_id: "", dms_user: "", dms_pass: "", dms_house_id: "", is_active: true
    });
    setIsFormModalOpen(true);
  };

  const openEditModal = (house: House) => {
    setEditingHouse(house);
    setFormData({
      name: house.name || "",
      code: house.code || "",
      cluster: house.cluster || "",
      region: house.region || "",
      wh_region: house.wh_region || "",
      district: house.district || "",
      email: house.email || "",
      address: house.address || "",
      proprietor_name: house.proprietor_name || "",
      proprietor_contact: house.proprietor_contact || "",
      poc_name: house.poc_name || "",
      poc_mobile: house.poc_mobile || "",
      lifting_date: house.lifting_date ? house.lifting_date.split(" ")[0] : "",
      latitude: house.latitude || "",
      longitude: house.longitude || "",
      bts_id: house.bts_id || "",
      dms_user: house.dms_user || "",
      dms_pass: house.dms_pass || "",
      dms_house_id: house.dms_house_id || "",
      is_active: house.is_active ?? true
    });
    setIsFormModalOpen(true);
  };

  const handleDeleteClick = (id: number) => {
    setDeletingId(id);
    setIsConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    try {
      await apiClient.delete(`houses/${deletingId}`);
      toast.success(t('houses.toast_delete_success'));
      setIsConfirmOpen(false);
      fetchHouses();
    } catch (err) {
      toast.error(t('houses.toast_delete_failed'));
    } finally {
      setDeletingId(null);
    }
  };

  const toggleStatus = async (house: House) => {
    try {
      const newStatus = !house.is_active;
      await apiClient.put(`houses/${house.id}`, { ...house, is_active: newStatus });
      toast.success(`${house.name} is now ${newStatus ? t('common.active') : t('common.inactive')}`);
      fetchHouses();
    } catch (err) {
      toast.error("Failed to update status");
    }
  };

  const handleSubmit = async (data: any) => {
    try {
      const url = editingHouse ? `houses/${editingHouse.id}` : 'houses';
      if (editingHouse) {
        await apiClient.put(url, data);
        toast.success(t('houses.toast_edit_success'));
      } else {
        await apiClient.post(url, data);
        toast.success(t('houses.toast_add_success'));
      }
      setIsFormModalOpen(false);
      fetchHouses();
    } catch (err) {
      toast.error(t('houses.toast_save_failed'));
    }
  };

  useEffect(() => {
    if (!authLoading && !hasPermission("houses.view")) {
      const timer = setTimeout(() => {
        router.push("/");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchHouses = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("page", String(page));
      params.append("per_page", "18");

      if (filters.search) params.append("search", filters.search);
      if (filters.cluster) params.append("cluster", filters.cluster);
      if (filters.region) params.append("region", filters.region);
      if (filters.wh_region) params.append("wh_region", filters.wh_region);
      if (filters.district) params.append("district", filters.district);

      if (filters.is_active !== null && filters.is_active !== undefined) {
        params.append("is_active", String(filters.is_active));
      }

      const response = await apiClient.get(`houses?${params.toString()}`);
      setHouses(response.data.data || []);
    } catch (err) {
      console.error("Failed to fetch houses", err);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    if (!authLoading && hasPermission("houses.view")) {
      fetchHouses();
    }
  }, [authLoading, hasPermission, fetchHouses]);

  if (!authLoading && !hasPermission("houses.view")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 transition-colors">{t('houses.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">{t('houses.description')}</p>
        </div>
        <button
          onClick={openAddModal}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl text-sm font-bold hover:shadow-lg hover:shadow-primary-500/20 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {t('houses.add_new')}
        </button>
      </div>

      <div className="relative">
        <div className="flex items-center gap-3 mb-6 bg-white dark:bg-slate-900 p-2 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm transition-colors duration-300">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "p-2.5 rounded-xl border transition-all cursor-pointer",
              showFilters
                ? "bg-primary-50 dark:bg-primary-500/10 border-primary-200 dark:border-primary-500/30 text-primary-600"
                : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-400 hover:text-gray-600"
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder={t('houses.search_placeholder')}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all dark:text-gray-100 outline-none"
              value={filters.search}
              onChange={(e) => {
                setFilters({ ...filters, search: e.target.value });
                setPage(1);
              }}
            />
          </div>
        </div>

        {/* Grid List */}
        {loading ? (
             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                 {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-64 rounded-2xl bg-gray-100 dark:bg-slate-800 animate-pulse" />
                 ))}
             </div>
        ) : houses.length === 0 ? (
          <div className="py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
               <Home className="w-8 h-8 text-gray-300 dark:text-gray-600" />
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t('houses.no_houses')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {houses.map((house) => (
              <HouseCard
                key={house.id}
                house={house}
                onEdit={() => openEditModal(house)}
                onDelete={() => handleDeleteClick(house.id)}
                onToggleStatus={() => toggleStatus(house)}
                canEdit={hasPermission("houses.edit")}
                canDelete={hasPermission("houses.delete")}
              />
            ))}
          </div>
        )}
      </div>
      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        title={t('houses.delete_confirm_title')}
        message={t('houses.delete_confirm_message')}
        type="danger"
      />
      <HouseFormModal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        onSubmit={handleSubmit}
        formData={formData}
        setFormData={setFormData}
        isEdit={!!editingHouse}
        loading={false}
      />
    </div>
  );
}
