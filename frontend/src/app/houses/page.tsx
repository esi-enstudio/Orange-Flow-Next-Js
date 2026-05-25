"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/api";
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
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 5;

  // Modal States
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [editingHouse, setEditingHouse] = useState<House | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  
  // Form State (Comprehensive)
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
      const response = await apiClient.get("/houses");
      const data = response.data.sort((a: House, b: House) => b.id - a.id);
      setHouses(data);
    } catch (err) {
      console.error("Failed to fetch houses", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHouses();
  }, []);

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
        await apiClient.put(`/houses/${editingHouse.id}`, formData);
        toast.success("House updated successfully!");
      } else {
        await apiClient.post("/houses", formData);
        toast.success("House registered successfully!");
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
      await apiClient.delete(`/houses/${deletingId}`);
      toast.success("House deleted successfully!");
      setIsConfirmOpen(false);
      fetchHouses();
    } catch (err) {
      toast.error("Failed to delete house");
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
      await apiClient.put(`/houses/${house.id}`, updatedData);
      toast.success(`${house.name} is now ${newStatus ? 'Active' : 'Inactive'}`);
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 transition-colors">Distribution Houses</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">Manage house profiles, POCs, and DMS credentials.</p>
        </div>
        <button 
          onClick={openAddModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-bold hover:bg-orange-700 transition-colors shadow-lg shadow-orange-200 dark:shadow-none"
        >
          <Plus className="w-4 h-4" />
          Add New House
        </button>
      </div>

      {/* DataTable Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden transition-colors duration-300">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input 
              type="text" 
              placeholder="Search houses..." 
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-orange-500 transition-all dark:text-gray-100 outline-none"
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
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500"></div>
          </div>
        ) : filteredHouses.length === 0 ? (
          <div className="py-20 text-center">
            <Home className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No distribution houses found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[800px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">House Info</th>
                    <th className="px-6 py-4">Location</th>
                    <th className="px-6 py-4">POC Details</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {paginatedHouses.map((house) => (
                    <tr key={house.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-500/20 flex items-center justify-center text-orange-700 dark:text-orange-400 font-bold shadow-sm">
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
                            <Layers className="w-3 h-3 text-orange-500" /> {house.cluster}
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
                          {house.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => openEditModal(house)}
                            className="p-2 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-xl text-gray-400 hover:text-orange-600 transition-all"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteClick(house.id)}
                            className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl text-gray-400 hover:text-red-600 transition-all"
                            title="Delete"
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
                Showing result {filteredHouses.length === 0 ? 0 : (page * limit) + 1} to {Math.min((page + 1) * limit, filteredHouses.length)} of {filteredHouses.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"><ChevronLeft className="w-4 h-4"/></button>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"><ChevronRight className="w-4 h-4"/></button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* House Add/Edit Modal (Fullscreen on Mobile, Large on Desktop) */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-full md:h-auto md:max-h-[90vh] md:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{editingHouse ? "Edit House Profile" : "Create New House"}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Fill all the details to register the distribution house.</p>
              </div>
              <button onClick={() => setIsFormModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl bg-gray-50 dark:bg-slate-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-6 scrollbar-hide">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* Section 1: Basic Info */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-orange-600 uppercase tracking-widest flex items-center gap-2"><Home className="w-4 h-4"/> Basic Information</h4>
                  <div className="space-y-4">
                    <InputField label="House Name" required value={formData.name} onChange={v => setFormData({...formData, name: v})} placeholder="e.g. Patwary Telecom" leftIcon={Home} error={fieldErrors.name} />
                    <InputField label="House Code" required value={formData.code} onChange={v => setFormData({...formData, code: v.toUpperCase()})} placeholder="e.g. MYMVAI01" disabled={!!editingHouse} leftIcon={Briefcase} error={fieldErrors.code} />
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label="Cluster" value={formData.cluster} onChange={v => setFormData({...formData, cluster: v})} placeholder="Savar" leftIcon={Layers} error={fieldErrors.cluster} />
                      <InputField label="Region" value={formData.region} onChange={v => setFormData({...formData, region: v})} placeholder="MYM" leftIcon={Globe} error={fieldErrors.region} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label="WH Region" value={formData.wh_region} onChange={v => setFormData({...formData, wh_region: v})} placeholder="Comilla" leftIcon={MapPin} error={fieldErrors.wh_region} />
                      <InputField label="District" value={formData.district} onChange={v => setFormData({...formData, district: v})} placeholder="Mymensingh" leftIcon={MapPin} error={fieldErrors.district} />
                    </div>
                    <InputField label="Full Address" value={formData.address} onChange={v => setFormData({...formData, address: v})} placeholder="123 Street Name..." leftIcon={MapPin} error={fieldErrors.address} />
                    <InputField label="Contact Email" type="email" value={formData.email} onChange={v => setFormData({...formData, email: v})} placeholder="house@example.com" leftIcon={Mail} error={fieldErrors.email} />
                    <InputField label="Lifting Date" type="date" value={formData.lifting_date} onChange={v => setFormData({...formData, lifting_date: v})} leftIcon={Calendar} error={fieldErrors.lifting_date} />
                  </div>
                </div>

                {/* Section 2: Management & Coordinates */}
                <div className="space-y-6">
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-purple-600 uppercase tracking-widest flex items-center gap-2"><User className="w-4 h-4"/> Management & Location</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label="Proprietor Name" value={formData.proprietor_name} onChange={v => setFormData({...formData, proprietor_name: v})} placeholder="Owner Name" leftIcon={User} error={fieldErrors.proprietor_name} />
                      <InputField label="Proprietor Contact" type="number" value={formData.proprietor_contact} onChange={v => setFormData({...formData, proprietor_contact: v})} placeholder="017xxxxxxxx" leftIcon={Phone} error={fieldErrors.proprietor_contact} onlyNumbers />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label="POC Name" value={formData.poc_name} onChange={v => setFormData({...formData, poc_name: v})} placeholder="Point of Contact" leftIcon={User} error={fieldErrors.poc_name} />
                      <InputField label="POC Mobile" type="number" value={formData.poc_mobile} onChange={v => setFormData({...formData, poc_mobile: v})} placeholder="017xxxxxxxx" leftIcon={Phone} error={fieldErrors.poc_mobile} onlyNumbers />
                    </div>
                    <div className="h-[1px] bg-gray-100 dark:bg-slate-800 my-2" />
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label="Latitude" value={formData.latitude} onChange={v => setFormData({...formData, latitude: v})} placeholder="24.37" leftIcon={Globe} error={fieldErrors.latitude} />
                      <InputField label="Longitude" value={formData.longitude} onChange={v => setFormData({...formData, longitude: v})} placeholder="91.00" leftIcon={Globe} error={fieldErrors.longitude} />
                    </div>
                    <InputField label="BTS ID" value={formData.bts_id} onChange={v => setFormData({...formData, bts_id: v})} placeholder="BTS-001" leftIcon={Smartphone} error={fieldErrors.bts_id} />
                  </div>

                  {/* Section 3: DMS Credentials */}
                  <div className="space-y-4 pt-2">
                    <h4 className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2"><Key className="w-4 h-4"/> DMS Access</h4>
                    <InputField label="DMS House ID" value={formData.dms_house_id} onChange={v => setFormData({...formData, dms_house_id: v})} placeholder="102938" leftIcon={Key} error={fieldErrors.dms_house_id} />
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label="DMS Username" value={formData.dms_user} onChange={v => setFormData({...formData, dms_user: v})} placeholder="user" leftIcon={User} error={fieldErrors.dms_user} />
                      <InputField label="DMS Password" type="password" value={formData.dms_pass} onChange={v => setFormData({...formData, dms_pass: v})} placeholder="••••" leftIcon={Lock} error={fieldErrors.dms_pass} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-10 pt-6 border-t border-gray-50 dark:border-slate-800 flex gap-4">
                <button type="button" onClick={() => setIsFormModalOpen(false)} className="flex-1 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-2xl transition-all">Cancel</button>
                <button type="submit" disabled={formLoading} className="flex-[2] py-3 bg-orange-600 text-white rounded-2xl text-sm font-bold hover:bg-orange-700 transition-all shadow-xl shadow-orange-200 dark:shadow-none flex items-center justify-center gap-2">
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingHouse ? "Update Distribution House" : "Register House"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Premium Confirmation Modal */}
      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        type="danger"
        title="Delete House?"
        message="Are you sure you want to remove this distribution house? This action cannot be undone."
        confirmText="Yes, Delete"
        loading={formLoading}
      />
    </div>
  );
}

// Reusable Input Field Component for this page
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
            error ? "text-red-500" : "text-gray-400 group-focus-within/input:text-orange-500"
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
              : "border-transparent focus:border-orange-500/30"
          )}
          placeholder={placeholder}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors rounded-xl hover:bg-orange-50 dark:hover:bg-orange-500/10"
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
