"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/api";
import { 
  Key, 
  Plus, 
  Search, 
  Trash2, 
  X, 
  Check, 
  Loader2,
  ShieldAlert
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";

interface Permission {
  id: number;
  name: string;
}

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newPermName, setNewPermName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchPermissions = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get("/permissions");
      setPermissions(response.data);
    } catch (err) {
      toast.error("Failed to fetch permissions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPermissions();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPermName.trim()) return;
    setFormLoading(true);
    try {
      await apiClient.post("/permissions", { name: newPermName.toLowerCase().replace(/\s+/g, '_') });
      toast.success("Permission created successfully!");
      setIsModalOpen(false);
      setNewPermName("");
      fetchPermissions();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to create permission");
    } finally {
      setFormLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    setFormLoading(true);
    try {
      await apiClient.delete(`/permissions/${deletingId}`);
      toast.success("Permission deleted successfully!");
      setIsConfirmOpen(false);
      fetchPermissions();
    } catch (err) {
      toast.error("Failed to delete permission");
    } finally {
      setFormLoading(false);
      setDeletingId(null);
    }
  };

  const filteredPermissions = permissions.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Permissions</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage granular system access keys.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-bold hover:bg-orange-700 transition-colors shadow-lg"
        >
          <Plus className="w-4 h-4" /> Add Permission
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b dark:border-slate-800">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search permissions..." 
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm outline-none dark:text-gray-100"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500"/></div>
        ) : filteredPermissions.length === 0 ? (
          <div className="py-20 text-center text-gray-500">No permissions found</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-4">
            {filteredPermissions.map((perm) => (
              <div key={perm.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl group transition-all hover:bg-orange-50 dark:hover:bg-orange-500/5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border dark:border-slate-700 flex items-center justify-center text-gray-400 group-hover:text-orange-500">
                    <Key className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-mono font-bold text-gray-700 dark:text-gray-300">{perm.name}</span>
                </div>
                <button 
                  onClick={() => {setDeletingId(perm.id); setIsConfirmOpen(true);}}
                  className="p-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-bold dark:text-gray-100">Add New Permission</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500 uppercase">Permission Name</label>
                <input 
                  type="text"
                  placeholder="e.g. view_reports"
                  className="w-full p-3 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm outline-none focus:ring-1 focus:ring-orange-500 dark:text-gray-100"
                  value={newPermName}
                  onChange={e => setNewPermName(e.target.value)}
                  required
                />
                <p className="text-[10px] text-gray-400 mt-1 italic">Use underscores instead of spaces (e.g., manage_users)</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-xl">Cancel</button>
                <button type="submit" disabled={formLoading || !newPermName} className="flex-[2] py-2.5 bg-orange-600 text-white rounded-xl text-sm font-bold hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
                  Create Permission
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
        title="Delete Permission?"
        message="This will remove the permission from all assigned roles. Continue?"
        type="danger"
        loading={formLoading}
      />
    </div>
  );
}
