"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/api";
import { 
  Users2, 
  Plus, 
  Search, 
  Trash2, 
  ChevronLeft, 
  ChevronRight,
  Loader2,
  X,
  Check,
  Edit2,
  Phone,
  Briefcase,
  User,
  CreditCard,
  MapPin,
  Calendar,
  Smartphone,
  Shield,
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";

interface FieldForce {
  id: number;
  house_id: number;
  user_id?: number;
  name: string;
  dms_code: string;
  itop_number: string;
  personal_number: string;
  type: string;
  status: string;
  joining_date: string;
  salary: string;
  market_type: string;
  itop_sr_number?: string;
  pool_number?: string;
  agency_id?: string;
}

interface House {
  id: number;
  name: string;
}

export default function FieldForcePage() {
  const [members, setMembers] = useState<FieldForce[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 8;

  // Modal States
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<FieldForce | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  
  // Form State
  const [formData, setFormData] = useState({
    house_id: 0,
    name: "",
    dms_code: "",
    itop_number: "",
    personal_number: "",
    type: "SR",
    status: "Active",
    joining_date: "",
    salary: "",
    market_type: "Urban",
    assisted_retailer_code: "",
    agency_id: "",
    pool_number: ""
  });
  const [formLoading, setFormLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ffRes, housesRes] = await Promise.all([
        apiClient.get("/field-force"),
        apiClient.get("/houses")
      ]);
      setMembers(ffRes.data);
      setHouses(housesRes.data);
      if (housesRes.data.length > 0 && !formData.house_id) {
        setFormData(prev => ({ ...prev, house_id: housesRes.data[0].id }));
      }
    } catch (err) {
      toast.error("Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openAddModal = () => {
    setEditingMember(null);
    setFormData({
      house_id: houses[0]?.id || 0,
      name: "",
      dms_code: "",
      itop_number: "",
      personal_number: "",
      type: "SR",
      status: "Active",
      joining_date: new Date().toISOString().split('T')[0],
      salary: "",
      market_type: "Urban",
      assisted_retailer_code: "",
      agency_id: "",
      pool_number: ""
    });
    setIsFormModalOpen(true);
  };

  const openEditModal = (m: FieldForce) => {
    setEditingMember(m);
    setFormData({
      house_id: m.house_id,
      name: m.name,
      dms_code: m.dms_code,
      itop_number: m.itop_number,
      personal_number: m.personal_number,
      type: m.type || "SR",
      status: m.status || "Active",
      joining_date: m.joining_date || "",
      salary: m.salary || "",
      market_type: m.market_type || "Urban",
      assisted_retailer_code: (m as any).assisted_retailer_code || "",
      agency_id: m.agency_id || "",
      pool_number: m.pool_number || ""
    });
    setIsFormModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    try {
      if (editingMember) {
        await apiClient.put(`/field-force/${editingMember.id}`, formData);
        toast.success("Member updated successfully");
      } else {
        await apiClient.post("/field-force", formData);
        toast.success("Member added successfully");
      }
      setIsFormModalOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Action failed");
    } finally {
      setFormLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    setFormLoading(true);
    try {
      await apiClient.delete(`/field-force/${deletingId}`);
      toast.success("Member deleted successfully");
      setIsConfirmOpen(false);
      fetchData();
    } catch (err) {
      toast.error("Delete failed");
    } finally {
      setFormLoading(false);
      setDeletingId(null);
    }
  };

  const filteredMembers = members.filter(m => 
    m.name.toLowerCase().includes(search.toLowerCase()) || 
    m.dms_code.toLowerCase().includes(search.toLowerCase()) ||
    m.itop_number.includes(search)
  );

  const paginatedMembers = filteredMembers.slice(page * limit, (page + 1) * limit);
  const totalPages = Math.ceil(filteredMembers.length / limit);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Field Force Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage SRs, BPs, and Supervisors across all houses.</p>
        </div>
        <button onClick={openAddModal} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-bold hover:bg-orange-700 transition-colors shadow-lg">
          <Plus className="w-4 h-4" /> Add New Member
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search by Name, Code or Number..." 
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm outline-none dark:text-gray-100"
              value={search}
              onChange={(e) => {setSearch(e.target.value); setPage(0);}}
            />
          </div>
        </div>

        {loading ? (
          <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500"/></div>
        ) : filteredMembers.length === 0 ? (
          <div className="py-20 text-center text-gray-500">No members found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-800 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b dark:border-slate-800">
                    <th className="px-6 py-4">Member Info</th>
                    <th className="px-6 py-4">DMS & iTop</th>
                    <th className="px-6 py-4">Role & House</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-800 text-sm">
                  {paginatedMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center text-purple-700">
                            <User className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100">{m.name}</p>
                            <p className="text-[10px] text-gray-500">{m.personal_number}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <p className="text-xs font-mono font-bold text-orange-600">{m.dms_code}</p>
                          <p className="text-[10px] text-gray-500 flex items-center gap-1"><Smartphone className="w-3 h-3"/> {m.itop_number}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 text-[10px] font-bold">
                            {m.type}
                          </span>
                          <p className="text-[10px] text-gray-500">{houses.find(h => h.id === m.house_id)?.name || "N/A"}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                          m.status === "Active" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                        )}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openEditModal(m)} className="p-2 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-lg text-gray-400 hover:text-orange-600"><Edit2 className="w-4 h-4"/></button>
                          <button onClick={() => {setDeletingId(m.id); setIsConfirmOpen(true);}} className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t dark:border-slate-800 flex items-center justify-between">
              <p className="text-xs text-gray-500">Page {page + 1} of {totalPages}</p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4"/></button>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="p-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-50"><ChevronRight className="w-4 h-4"/></button>
              </div>
            </div>
          </>
        )}
      </div>

      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-bold dark:text-gray-100">{editingMember ? "Edit Member" : "New Member"}</h3>
              <button onClick={() => setIsFormModalOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleFormSubmit} className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-500 uppercase">Assigned House</label>
                  <select 
                    className="w-full p-2 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm"
                    value={formData.house_id}
                    onChange={e => setFormData({...formData, house_id: parseInt(e.target.value)})}
                  >
                    {houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
                <InputField label="Full Name" value={formData.name} onChange={(v: string) => setFormData({...formData, name: v})} required />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <InputField label="DMS Code" value={formData.dms_code} onChange={(v: string) => setFormData({...formData, dms_code: v})} required />
                <InputField label="iTop Number" value={formData.itop_number} onChange={(v: string) => setFormData({...formData, itop_number: v})} required />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <InputField label="Personal Number" value={formData.personal_number} onChange={(v: string) => setFormData({...formData, personal_number: v})} />
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-500 uppercase">Type</label>
                  <select 
                    className="w-full p-2 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm"
                    value={formData.type}
                    onChange={e => setFormData({...formData, type: e.target.value})}
                  >
                    <option value="SR">SR</option>
                    <option value="BP">BP</option>
                    <option value="Supervisor">Supervisor</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <InputField label="Joining Date" type="date" value={formData.joining_date} onChange={(v: string) => setFormData({...formData, joining_date: v})} />
                <InputField label="Salary" value={formData.salary} onChange={(v: string) => setFormData({...formData, salary: v})} />
              </div>

              <div className="flex gap-4 mt-6">
                <button type="button" onClick={() => setIsFormModalOpen(false)} className="flex-1 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-xl">Cancel</button>
                <button type="submit" disabled={formLoading} className="flex-[2] py-2 bg-orange-600 text-white rounded-xl text-sm font-bold hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
                  {editingMember ? "Save Changes" : "Register Member"}
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
        title="Delete Member?"
        message="Permanently remove this member from the field force list?"
        type="danger"
        loading={formLoading}
      />
    </div>
  );
}

function InputField({ label, value, onChange, required, type = "text" }: any) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-bold text-gray-500 uppercase">{label} {required && "*"}</label>
      <input 
        type={type}
        className="w-full p-2 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm outline-none focus:ring-1 focus:ring-orange-500 dark:text-gray-100"
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
      />
    </div>
  );
}
