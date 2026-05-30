"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { 
  Home, 
  Plus, 
  Search, 
  Trash2, 
  MapPin, 
  Layers, 
  ChevronLeft, 
  ChevronRight,
  Loader2,
  X,
  Check,
  Edit2,
  Globe,
  Mail,
  User,
  Phone,
  Briefcase,
  Key,
  Smartphone,
  Eye,
  EyeOff,
  Calendar,
  Lock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";

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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 5;

  useEffect(() => {
    if (!authLoading && !hasPermission("view_houses")) {
      const timer = setTimeout(() => {
        router.push("/");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

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
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const fetchHouses = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get("houses");
      const data = response.data.sort((a: House, b: House) => b.id - a.id);
      setHouses(data);
    } catch (err) {
      console.error("Failed to fetch houses", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("view_houses")) {
      fetchHouses();
    }
  }, [authLoading, hasPermission]);

  const openAddModal = () => {
    setEditingHouse(null);
    setFormData({
      name: "", code: "", cluster: "", region: "", wh_region: "", district: "",
      email: "", address: "", proprietor_name: "", proprietor_contact: "",
      poc_name: "", poc_mobile: "", lifting_date: "", latitude: "", longitude: "",
      bts_id: "", dms_user: "", dms_pass: "", dms_house_id: "", is_active: true
    });
    setFormError("");
    setFieldErrors({});
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
    setFormError("");
    setFieldErrors({});
    setIsFormModalOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    const bdPhoneRegex = /^01[3-9]\d{8}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!formData.name.trim()) errors.name = "House name is required";
    if (!formData.code.trim()) errors.code = "House code is required";
    if (!formData.cluster.trim()) errors.cluster = "Cluster is required";
    if (!formData.region.trim()) errors.region = "Region is required";
    if (!formData.wh_region.trim()) errors.wh_region = "WH Region is required";
    if (!formData.district.trim()) errors.district = "District is required";
    if (!formData.address.trim()) errors.address = "Full address is required";
    if (!formData.lifting_date) errors.lifting_date = "Lifting date is required";
    if (!formData.proprietor_name.trim()) errors.proprietor_name = "Proprietor name is required";
    
    if (formData.proprietor_contact && !bdPhoneRegex.test(formData.proprietor_contact)) {
      errors.proprietor_contact = "Invalid BD mobile number (e.g. 01712345678)";
    }
    
    if (!formData.poc_name.trim()) errors.poc_name = "POC name is required";
    if (!formData.poc_mobile.trim()) {
      errors.poc_mobile = "POC mobile is required";
    } else if (!bdPhoneRegex.test(formData.poc_mobile)) {
      errors.poc_mobile = "Invalid BD mobile number";
    }

    if (formData.email && !emailRegex.test(formData.email)) {
      errors.email = "Invalid email format";
    }

    if (!formData.dms_house_id.trim()) errors.dms_house_id = "DMS House ID is required";
    if (!formData.dms_user.trim()) errors.dms_user = "DMS username is required";
    if (!formData.dms_pass.trim()) errors.dms_pass = "DMS password is required";

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      toast.error("Please fix the errors in the form");
      return;
    }
    setFormLoading(true);
    setFormError("");
    try {
      if (editingHouse) {
        await apiClient.put(`houses/${editingHouse.id}`, formData);
        toast.success(t('houses.toast_update_success'));
      } else {
        await apiClient.post("houses", formData);
        toast.success(t('houses.toast_create_success'));
      }
      setIsFormModalOpen(false);
      fetchHouses();
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || "Action failed";
      setFormError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteClick = (id: number) => {
    setDeletingId(id);
    setIsConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    setFormLoading(true);
    try {
      await apiClient.delete(`houses/${deletingId}`);
      toast.success(t('houses.toast_delete_success'));
      setIsConfirmOpen(false);
      fetchHouses();
    } catch (err) {
      toast.error(t('houses.toast_delete_failed'));
    } finally {
      setFormLoading(false);
      setDeletingId(null);
    }
  };

  const toggleStatus = async (house: House) => {
    try {
      const newStatus = !house.is_active;
      const updatedData = { 
        ...house, 
        is_active: newStatus,
        lifting_date: house.lifting_date ? house.lifting_date.split(" ")[0] : "" 
      };
      await apiClient.put(`houses/${house.id}`, updatedData);
      toast.success(`${house.name} is now ${newStatus ? t('common.active') : t('common.inactive')}`);
      fetchHouses();
    } catch (err) {
      toast.error("Failed to update status");
    }
  };

  const filteredHouses = houses.filter(h => 
    h.name?.toLowerCase().includes(search.toLowerCase()) || 
    h.code?.toLowerCase().includes(search.toLowerCase())
  );

  const paginatedHouses = filteredHouses.slice(page * limit, (page + 1) * limit);
  const totalPages = Math.ceil(filteredHouses.length / limit);

  if (!authLoading && !hasPermission("view_houses")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 transition-colors">{t('houses.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">{t('houses.description')}</p>
        </div>
        <button 
          onClick={openAddModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none"
        >
          <Plus className="w-4 h-4" />
          {t('houses.add_new')}
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden transition-colors duration-300">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input 
              type="text" 
              placeholder={t('houses.search_placeholder')}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all dark:text-gray-100 outline-none"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500"></div>
          </div>
        ) : filteredHouses.length === 0 ? (
          <div className="py-20 text-center">
            <Home className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t('houses.no_houses')}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[800px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">{t('houses.table_info')}</th>
                    <th className="px-6 py-4">{t('houses.table_location')}</th>
                    <th className="px-6 py-4">{t('houses.table_poc')}</th>
                    <th className="px-6 py-4">{t('houses.table_status')}</th>
                    <th className="px-6 py-4 text-right">{t('houses.table_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {paginatedHouses.map((house) => (
                    <tr key={house.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 font-bold shadow-sm">
                            <Home className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{house.name}</p>
                            <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">{house.code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <p className="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                            <Layers className="w-3 h-3 text-primary-500" /> {house.cluster}
                          </p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-500 flex items-center gap-1.5">
                            <MapPin className="w-3 h-3" /> {house.region} {house.district ? `(${house.district})` : ""}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                         <div className="space-y-1">
                          <p className="text-xs font-bold text-gray-700 dark:text-gray-200">{house.poc_name || "N/A"}</p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400">{house.poc_mobile || "No Contact"}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => toggleStatus(house)}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all hover:opacity-80 active:scale-95 cursor-pointer",
                            house.is_active 
                              ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                              : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                          )}
                          title="Click to toggle status"
                        >
                          <span className={cn("w-1.5 h-1.5 rounded-full", house.is_active ? "bg-green-500" : "bg-red-500")}></span>
                          {house.is_active ? t('common.active') : t('common.inactive')}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => openEditModal(house)}
                            className="p-2 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-xl text-gray-400 hover:text-primary-600 transition-all"
                            title={t('common.edit')}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteClick(house.id)}
                            className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl text-gray-400 hover:text-red-600 transition-all"
                            title={t('common.delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('houses.showing_results', { start: filteredHouses.length === 0 ? 0 : (page * limit) + 1, end: Math.min((page + 1) * limit, filteredHouses.length), total: filteredHouses.length })}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"><ChevronLeft className="w-4 h-4"/></button>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"><ChevronRight className="w-4 h-4"/></button>
              </div>
            </div>
          </>
        )}
      </div>

      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-full md:h-auto md:max-h-[90vh] md:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{editingHouse ? t('houses.modal_edit_title') : t('houses.modal_create_title')}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('houses.modal_subtitle')}</p>
              </div>
              <button onClick={() => setIsFormModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl bg-gray-50 dark:bg-slate-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-6 scrollbar-hide">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-primary-600 uppercase tracking-widest flex items-center gap-2"><Home className="w-4 h-4"/> {t('houses.section_basic')}</h4>
                  <div className="space-y-4">
                    <InputField label={t('houses.field_house_name')} required value={formData.name} onChange={(v: string) => setFormData({...formData, name: v})} placeholder={t('houses.field_house_name_placeholder')} leftIcon={Home} error={fieldErrors.name} />
                    <InputField label={t('houses.field_house_code')} required value={formData.code} onChange={(v: string) => setFormData({...formData, code: v.toUpperCase()})} placeholder={t('houses.field_house_code_placeholder')} disabled={!!editingHouse} leftIcon={Briefcase} error={fieldErrors.code} />
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label={t('houses.field_cluster')} value={formData.cluster} onChange={(v: string) => setFormData({...formData, cluster: v})} placeholder={t('houses.field_cluster_placeholder')} leftIcon={Layers} error={fieldErrors.cluster} />
                      <InputField label={t('houses.field_region')} value={formData.region} onChange={(v: string) => setFormData({...formData, region: v})} placeholder={t('houses.field_region_placeholder')} leftIcon={Globe} error={fieldErrors.region} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label={t('houses.field_wh_region')} value={formData.wh_region} onChange={(v: string) => setFormData({...formData, wh_region: v})} placeholder={t('houses.field_wh_region_placeholder')} leftIcon={MapPin} error={fieldErrors.wh_region} />
                      <InputField label={t('houses.field_district')} value={formData.district} onChange={(v: string) => setFormData({...formData, district: v})} placeholder={t('houses.field_district_placeholder')} leftIcon={MapPin} error={fieldErrors.district} />
                    </div>
                    <InputField label={t('houses.field_address')} value={formData.address} onChange={(v: string) => setFormData({...formData, address: v})} placeholder={t('houses.field_address_placeholder')} leftIcon={MapPin} error={fieldErrors.address} />
                    <InputField label={t('houses.field_email')} type="email" value={formData.email} onChange={(v: string) => setFormData({...formData, email: v})} placeholder={t('houses.field_email_placeholder')} leftIcon={Mail} error={fieldErrors.email} />
                    <InputField label={t('houses.field_lifting_date')} type="date" value={formData.lifting_date} onChange={(v: string) => setFormData({...formData, lifting_date: v})} leftIcon={Calendar} error={fieldErrors.lifting_date} />
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-purple-600 uppercase tracking-widest flex items-center gap-2"><User className="w-4 h-4"/> {t('houses.section_management')}</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label={t('houses.field_proprietor_name')} value={formData.proprietor_name} onChange={(v: string) => setFormData({...formData, proprietor_name: v})} placeholder={t('houses.field_proprietor_name_placeholder')} leftIcon={User} error={fieldErrors.proprietor_name} />
                      <InputField label={t('houses.field_proprietor_contact')} type="number" value={formData.proprietor_contact} onChange={(v: string) => setFormData({...formData, proprietor_contact: v})} placeholder={t('houses.field_proprietor_contact_placeholder')} leftIcon={Phone} error={fieldErrors.proprietor_contact} onlyNumbers />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label={t('houses.field_poc_name')} value={formData.poc_name} onChange={(v: string) => setFormData({...formData, poc_name: v})} placeholder={t('houses.field_poc_name_placeholder')} leftIcon={User} error={fieldErrors.poc_name} />
                      <InputField label={t('houses.field_poc_mobile')} type="number" value={formData.poc_mobile} onChange={(v: string) => setFormData({...formData, poc_mobile: v})} placeholder={t('houses.field_poc_mobile_placeholder')} leftIcon={Phone} error={fieldErrors.poc_mobile} onlyNumbers />
                    </div>
                    <div className="h-[1px] bg-gray-100 dark:bg-slate-800 my-2" />
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label={t('houses.field_latitude')} value={formData.latitude} onChange={(v: string) => setFormData({...formData, latitude: v})} placeholder={t('houses.field_latitude_placeholder')} leftIcon={Globe} error={fieldErrors.latitude} />
                      <InputField label={t('houses.field_longitude')} value={formData.longitude} onChange={(v: string) => setFormData({...formData, longitude: v})} placeholder={t('houses.field_longitude_placeholder')} leftIcon={Globe} error={fieldErrors.longitude} />
                    </div>
                    <InputField label={t('houses.field_bts_id')} value={formData.bts_id} onChange={(v: string) => setFormData({...formData, bts_id: v})} placeholder={t('houses.field_bts_id_placeholder')} leftIcon={Smartphone} error={fieldErrors.bts_id} />
                  </div>

                  <div className="space-y-4 pt-2">
                    <h4 className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2"><Key className="w-4 h-4"/> {t('houses.section_dms')}</h4>
                    <InputField label={t('houses.field_dms_house_id')} value={formData.dms_house_id} onChange={(v: string) => setFormData({...formData, dms_house_id: v})} placeholder={t('houses.field_dms_house_id_placeholder')} leftIcon={Key} error={fieldErrors.dms_house_id} />
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label={t('houses.field_dms_user')} value={formData.dms_user} onChange={(v: string) => setFormData({...formData, dms_user: v})} placeholder={t('houses.field_dms_user_placeholder')} leftIcon={User} error={fieldErrors.dms_user} />
                      <InputField label={t('houses.field_dms_pass')} type="password" value={formData.dms_pass} onChange={(v: string) => setFormData({...formData, dms_pass: v})} placeholder="••••" leftIcon={Lock} error={fieldErrors.dms_pass} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-10 pt-6 border-t border-gray-50 dark:border-slate-800 flex gap-4">
                <button type="button" onClick={() => setIsFormModalOpen(false)} className="flex-1 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-2xl transition-all">{t('houses.btn_cancel')}</button>
                <button type="submit" disabled={formLoading} className="flex-[2] py-3 bg-primary-600 text-white rounded-2xl text-sm font-bold hover:bg-primary-700 transition-all shadow-xl shadow-primary-200 dark:shadow-none flex items-center justify-center gap-2">
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingHouse ? t('houses.btn_update') : t('houses.btn_create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        type="danger"
        title={t('houses.delete_title')}
        message={t('houses.delete_message')}
        confirmText={t('houses.delete_confirm')}
        loading={formLoading}
      />
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, required = false, type = "text", disabled = false, leftIcon: Icon, error, onlyNumbers = false }: any) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (show ? "text" : "password") : type;

  const handleChange = (val: string) => {
    if (onlyNumbers) {
      const numericValue = val.replace(/\D/g, "");
      onChange(numericValue);
    } else {
      onChange(val);
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5 ml-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative group/input">
        {Icon && (
          <div className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 transition-colors",
            error ? "text-red-500" : "text-gray-400 group-focus-within/input:text-primary-500"
          )}>
            <Icon className="w-4 h-4" />
          </div>
        )}
        <input
          type={inputType}
          required={required}
          disabled={disabled}
          className={cn(
            "w-full py-3 bg-gray-50 dark:bg-slate-800/50 border transition-all dark:text-gray-100 outline-none disabled:opacity-50 rounded-2xl text-sm",
            Icon ? "pl-11" : "pl-4",
            isPassword ? "pr-12" : "pr-4",
            error 
              ? "border-red-500/50 focus:border-red-500 ring-1 ring-red-500/10" 
              : "border-transparent focus:border-primary-500/30"
          )}
          placeholder={placeholder}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-primary-500 dark:hover:text-primary-400 transition-colors rounded-xl hover:bg-primary-50 dark:hover:bg-primary-500/10"
            title={show ? "Hide Password" : "Show Password"}
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error && <p className="text-[10px] text-red-500 font-bold ml-1 animate-in slide-in-from-top-1 duration-200">{error}</p>}
    </div>
  );
}
