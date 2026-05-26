"use client";

import { useEffect, useState, useRef } from "react";
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
  User,
  Phone,
  Briefcase,
  Key,
  Smartphone,
  Calendar,
  Lock,
  Store,
  Tag,
  Hash,
  Upload,
  FileSpreadsheet,
  AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";

interface House {
  id: number;
  name: string;
  code: string;
}

interface Retailer {
  id: number;
  house_id: number;
  retailer_code: string;
  name: string;
  type: string;
  enabled: string;
  sim_seller: string;
  tran_mobile_no: string;
  itop_sr_number: string;
  itop_number: string;
  service_point: string;
  category: string;
  owner_name: string;
  contact_no: string;
  district: string;
  thana: string;
  address: string;
  nid: string;
  bp_code: string;
  bp_number: string;
  dob: string;
  route: string;
  house?: { name: string, code: string };
  employee?: { name: string, itop_number: string };
}

export default function RetailersPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 5; 

  // Permission Check
  useEffect(() => {
    if (!authLoading && !hasPermission("view_retailers")) {
      router.push("/");
    }
  }, [authLoading, hasPermission, router]);

  // Modal States
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [editingRetailer, setEditingRetailer] = useState<Retailer | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  
  // Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const [formData, setFormData] = useState({
    house_id: selectedHouse?.id || 0,
    retailer_code: "",
    name: "",
    type: "",
    enabled: "Yes",
    sim_seller: "",
    tran_mobile_no: "",
    itop_sr_number: "",
    itop_number: "",
    service_point: "",
    category: "",
    owner_name: "",
    contact_no: "",
    district: "",
    thana: "",
    address: "",
    nid: "",
    bp_code: "",
    bp_number: "",
    dob: "",
    route: ""
  });

  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const [retRes, houseRes] = await Promise.all([
        apiClient.get("/retailers"),
        apiClient.get("/houses")
      ]);
      setRetailers(retRes.data);
      setHouses(houseRes.data);
    } catch (err) {
      console.error("Failed to fetch data", err);
      toast.error("Failed to load retailers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedHouse]); // Refetch when house changes

  const openAddModal = () => {
    setEditingRetailer(null);
    setFormData({
      house_id: selectedHouse?.id || houses[0]?.id || 0,
      retailer_code: "",
      name: "",
      type: "",
      enabled: "Yes",
      sim_seller: "",
      tran_mobile_no: "",
      itop_sr_number: "",
      itop_number: "",
      service_point: "",
      category: "",
      owner_name: "",
      contact_no: "",
      district: "",
      thana: "",
      address: "",
      nid: "",
      bp_code: "",
      bp_number: "",
      dob: "",
      route: ""
    });
    setFormError("");
    setFieldErrors({});
    setIsFormModalOpen(true);
  };

  const openEditModal = (retailer: Retailer) => {
    setEditingRetailer(retailer);
    setFormData({
      house_id: retailer.house_id,
      retailer_code: retailer.retailer_code || "",
      name: retailer.name || "",
      type: retailer.type || "",
      enabled: retailer.enabled || "Yes",
      sim_seller: retailer.sim_seller || "",
      tran_mobile_no: retailer.tran_mobile_no || "",
      itop_sr_number: retailer.itop_sr_number || "",
      itop_number: retailer.itop_number || "",
      service_point: retailer.service_point || "",
      category: retailer.category || "",
      owner_name: retailer.owner_name || "",
      contact_no: retailer.contact_no || "",
      district: retailer.district || "",
      thana: retailer.thana || "",
      address: retailer.address || "",
      nid: retailer.nid || "",
      bp_code: retailer.bp_code || "",
      bp_number: retailer.bp_number || "",
      dob: retailer.dob || "",
      route: retailer.route || ""
    });
    setFormError("");
    setFieldErrors({});
    setIsFormModalOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    const bdPhoneRegex = /^01[3-9]\d{8}$/;

    if (!formData.house_id) errors.house_id = "House selection is required";
    if (!formData.retailer_code.trim()) errors.retailer_code = "Retailer code is required";
    if (!formData.name.trim()) errors.name = "Retailer name is required";
    if (!formData.itop_number.trim()) {
        errors.itop_number = "iTop number is required";
    } else if (!bdPhoneRegex.test(formData.itop_number)) {
        errors.itop_number = "Invalid BD number";
    }
    
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
      if (editingRetailer) {
        await apiClient.put(`/retailers/${editingRetailer.id}`, formData);
        toast.success("Retailer updated successfully!");
      } else {
        await apiClient.post("/retailers", formData);
        toast.success("Retailer registered successfully!");
      }
      setIsFormModalOpen(false);
      fetchData();
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || "Action failed";
      setFormError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setFormLoading(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!formData.house_id) {
        toast.error("Please select a Distribution House first");
        return;
    }

    setIsImporting(true);
    setImportProgress(20);
    
    const importData = new FormData();
    importData.append("file", file);
    
    try {
      setImportProgress(40);
      const response = await apiClient.post(`/retailers/import?house_id=${formData.house_id}`, importData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setImportProgress(100);
      toast.success(response.data.message);
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Import failed");
    } finally {
      setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }, 1000);
    }
  };

  const toggleStatus = async (retailer: Retailer) => {
    try {
      const isCurrentlyEnabled = retailer.enabled === "Yes" || retailer.enabled === "Y";
      const newEnabled = isCurrentlyEnabled ? "No" : "Yes";
      const updatedData = { ...retailer, enabled: newEnabled };
      await apiClient.put(`/retailers/${retailer.id}`, updatedData);
      toast.success(`${retailer.name} is now ${newEnabled === 'Yes' ? 'Enabled' : 'Disabled'}`);
      fetchData();
    } catch (err) {
      toast.error("Failed to update status");
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
      await apiClient.delete(`/retailers/${deletingId}`);
      toast.success("Retailer deleted successfully!");
      setIsConfirmOpen(false);
      fetchData();
    } catch (err) {
      toast.error("Failed to delete retailer");
    } finally {
      setFormLoading(false);
      setDeletingId(null);
    }
  };

  const filteredRetailers = retailers.filter(r => 
    r.name?.toLowerCase().includes(search.toLowerCase()) || 
    r.retailer_code?.toLowerCase().includes(search.toLowerCase()) ||
    r.itop_number?.includes(search)
  );

  const paginatedRetailers = filteredRetailers.slice(page * limit, (page + 1) * limit);
  const totalPages = Math.ceil(filteredRetailers.length / limit);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Retailer List</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">Manage retailers, iTop numbers and locations.</p>
        </div>
        <div className="flex flex-wrap gap-3">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx, .xls" />
            <button 
                onClick={handleImportClick}
                disabled={isImporting || !selectedHouse}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
            >
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Import List
            </button>
            <button 
                onClick={openAddModal}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-bold hover:bg-orange-700 transition-colors shadow-lg shadow-orange-200 dark:shadow-none"
            >
                <Plus className="w-4 h-4" />
                Add New Retailer
            </button>
        </div>
      </div>

      {/* Progress Bar for Import */}
      {isImporting && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-orange-100 dark:border-orange-500/20 shadow-xl animate-in slide-in-from-top-4 duration-300">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 dark:bg-orange-500/20 rounded-xl text-orange-600">
                        <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Processing Retailer List...</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Please wait while we sync the data with the database.</p>
                    </div>
                </div>
                <span className="text-sm font-black text-orange-600">{importProgress}%</span>
            </div>
            <div className="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div 
                    className="h-full bg-orange-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(249,115,22,0.5)]" 
                    style={{ width: `${importProgress}%` }}
                />
            </div>
        </div>
      )}

      {/* DataTable Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden transition-colors duration-300">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input 
              type="text" 
              placeholder="Search by name, code or iTop..." 
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
        ) : filteredRetailers.length === 0 ? (
          <div className="py-20 text-center">
            <Store className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No retailers found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[900px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">Retailer Name</th>
                    <th className="px-6 py-4">RSO Info</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Distribution House</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {paginatedRetailers.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-500/20 flex items-center justify-center text-orange-700 dark:text-orange-400 font-bold shadow-sm">
                            <Store className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{r.name}</p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                                <Phone className="w-2.5 h-2.5" /> {r.itop_number} <Hash className="w-2.5 h-2.5 ml-1" /> {r.retailer_code}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                            <User className="w-3 h-3 text-purple-500" /> {r.employee?.name || "No RSO"}
                          </p>
                          {r.employee?.itop_number && (
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono flex items-center gap-1">
                                <Smartphone className="w-2.5 h-2.5 text-blue-500" /> {r.employee.itop_number}
                            </p>
                          )}
                        </div>
                      </td>
                    <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                            {(() => {
                              const isEnabled = r.enabled === "Yes" || r.enabled === "Y";
                              const isSimSeller = r.sim_seller === "Yes" || r.sim_seller === "Y";
                              return (
                                <>
                                  <button
                                    onClick={() => toggleStatus(r)}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all hover:opacity-80 active:scale-95 cursor-pointer w-fit",
                                        isEnabled
                                        ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                                        : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                                    )}
                                  >
                                      <span className={cn("w-1 h-1 rounded-full", isEnabled ? "bg-green-500" : "bg-red-500")}></span>
                                      {isEnabled ? "Enabled" : "Disabled"}
                                  </button>
                                  <span className={cn(
                                      "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit",
                                      isSimSeller ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" : "bg-gray-50 text-gray-500 dark:bg-slate-800"
                                  )}>
                                      SIM SELLER: {isSimSeller ? "Yes" : "No"}
                                  </span>
                                </>
                              );
                            })()}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1 text-xs">
                          <p className="font-bold text-gray-700 dark:text-gray-200">{r.house?.name || "N/A"}</p>
                          <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">{r.house?.code || ""}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => openEditModal(r)}
                            className="p-2 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-xl text-gray-400 hover:text-orange-600 transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteClick(r.id)}
                            className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl text-gray-400 hover:text-red-600 transition-all"
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
                Showing result {filteredRetailers.length === 0 ? 0 : (page * limit) + 1} to {Math.min((page + 1) * limit, filteredRetailers.length)} of {filteredRetailers.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"><ChevronLeft className="w-4 h-4"/></button>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"><ChevronRight className="w-4 h-4"/></button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Retailer Add/Edit Modal (Fullscreen on Mobile, Multi-column on Desktop) */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-6xl h-full md:h-auto md:max-h-[95vh] md:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{editingRetailer ? "Edit Retailer Profile" : "Register New Retailer"}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Full control over business identity, network info, and locations.</p>
              </div>
              <button onClick={() => setIsFormModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl bg-gray-50 dark:bg-slate-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-6 scrollbar-hide">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                
                {/* Section 1: Business Identity */}
                <div className="space-y-5">
                  <h4 className="text-xs font-bold text-orange-600 uppercase tracking-widest flex items-center gap-2"><Store className="w-4 h-4"/> Business Identity</h4>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5 ml-1">Distribution House <span className="text-red-500">*</span></label>
                        <div className="relative group/input">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within/input:text-orange-500"><Home className="w-4 h-4"/></div>
                            <select 
                                value={formData.house_id}
                                onChange={e => setFormData({...formData, house_id: parseInt(e.target.value)})}
                                className="w-full py-3 pl-11 pr-4 bg-gray-50 dark:bg-slate-800/50 border border-transparent focus:border-orange-500/30 rounded-2xl text-sm outline-none transition-all dark:text-gray-100"
                            >
                                {houses.map(h => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
                            </select>
                        </div>
                    </div>
                    <InputField label="Retailer Name" required value={formData.name} onChange={v => setFormData({...formData, name: v})} placeholder="e.g. Bhai Bhai Telecom" leftIcon={Store} error={fieldErrors.name} />
                    <InputField label="Retailer Code" required value={formData.retailer_code} onChange={v => setFormData({...formData, retailer_code: v.toUpperCase()})} placeholder="DHK12345" leftIcon={Hash} error={fieldErrors.retailer_code} />
                    <div className="grid grid-cols-2 gap-4">
                        <InputField label="Type" value={formData.type} onChange={v => setFormData({...formData, type: v})} placeholder="M-Pesa" leftIcon={Tag} />
                        <InputField label="Category" value={formData.category} onChange={v => setFormData({...formData, category: v})} placeholder="A/B/C" leftIcon={Layers} />
                    </div>
                    <InputField label="Route / Beat" value={formData.route} onChange={v => setFormData({...formData, route: v})} placeholder="Savar Route 01" leftIcon={MapPin} />
                  </div>
                </div>

                {/* Section 2: Network Info */}
                <div className="space-y-5">
                    <h4 className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2"><Globe className="w-4 h-4"/> Network & iTop</h4>
                    <div className="space-y-4">
                        <InputField label="iTop Number" required type="number" value={formData.itop_number} onChange={v => setFormData({...formData, itop_number: v})} placeholder="017xxxxxxxx" leftIcon={Phone} error={fieldErrors.itop_number} onlyNumbers />
                        <InputField label="SR Number" type="number" value={formData.itop_sr_number} onChange={v => setFormData({...formData, itop_sr_number: v})} placeholder="017xxxxxxxx" leftIcon={Phone} onlyNumbers />
                        <InputField label="Transactional Mobile" type="number" value={formData.tran_mobile_no} onChange={v => setFormData({...formData, tran_mobile_no: v})} placeholder="017xxxxxxxx" leftIcon={Smartphone} onlyNumbers />
                        <div className="grid grid-cols-2 gap-4">
                            <InputField label="BP Code" value={formData.bp_code} onChange={v => setFormData({...formData, bp_code: v})} placeholder="BP001" leftIcon={Hash} />
                            <InputField label="BP Number" value={formData.bp_number} onChange={v => setFormData({...formData, bp_number: v})} placeholder="BP-123" leftIcon={Hash} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <InputField label="Sim Seller" value={formData.sim_seller} onChange={v => setFormData({...formData, sim_seller: v})} placeholder="Yes/No" leftIcon={Check} />
                            <InputField label="Service Point" value={formData.service_point} onChange={v => setFormData({...formData, service_point: v})} placeholder="Yes/No" leftIcon={MapPin} />
                        </div>
                    </div>
                </div>

                {/* Section 3: Owner & Location */}
                <div className="space-y-5">
                    <h4 className="text-xs font-bold text-purple-600 uppercase tracking-widest flex items-center gap-2"><User className="w-4 h-4"/> Owner & Location</h4>
                    <div className="space-y-4">
                        <InputField label="Owner Name" value={formData.owner_name} onChange={v => setFormData({...formData, owner_name: v})} placeholder="Name of proprietor" leftIcon={User} />
                        <InputField label="Contact No" type="number" value={formData.contact_no} onChange={v => setFormData({...formData, contact_no: v})} placeholder="017xxxxxxxx" leftIcon={Phone} onlyNumbers />
                        <InputField label="NID Number" type="number" value={formData.nid} onChange={v => setFormData({...formData, nid: v})} placeholder="1234567890" leftIcon={Hash} onlyNumbers />
                        <div className="grid grid-cols-2 gap-4">
                            <InputField label="District" value={formData.district} onChange={v => setFormData({...formData, district: v})} placeholder="Dhaka" leftIcon={MapPin} />
                            <InputField label="Thana" value={formData.thana} onChange={v => setFormData({...formData, thana: v})} placeholder="Savar" leftIcon={MapPin} />
                        </div>
                        <InputField label="Full Address" value={formData.address} onChange={v => setFormData({...formData, address: v})} placeholder="Street, Holding No..." leftIcon={MapPin} />
                        <InputField label="Date of Birth" type="date" value={formData.dob} onChange={v => setFormData({...formData, dob: v})} leftIcon={Calendar} />
                    </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-10 pt-6 border-t border-gray-50 dark:border-slate-800 flex gap-4">
                <button type="button" onClick={() => setIsFormModalOpen(false)} className="flex-1 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-2xl transition-all">Cancel</button>
                <button type="submit" disabled={formLoading} className="flex-[2] py-3 bg-orange-600 text-white rounded-2xl text-sm font-bold hover:bg-orange-700 transition-all shadow-xl shadow-orange-200 dark:shadow-none flex items-center justify-center gap-2">
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingRetailer ? "Update Retailer" : "Register Retailer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        type="danger"
        title="Delete Retailer?"
        message="Are you sure you want to remove this retailer? All associated data will be affected."
        confirmText="Yes, Delete"
        loading={formLoading}
      />
    </div>
  );
}

// Reusable Input Field Component
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
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error && <p className="text-[10px] text-red-500 font-bold ml-1 animate-in slide-in-from-top-1 duration-200">{error}</p>}
    </div>
  );
}
