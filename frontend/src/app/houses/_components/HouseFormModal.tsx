"use client";

import { useLanguage } from "@/i18n/useLanguage";
import { X } from "lucide-react";

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

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  formData: any;
  setFormData: (data: any) => void;
  isEdit: boolean;
  loading: boolean;
}

export default function HouseFormModal({ isOpen, onClose, onSubmit, formData, setFormData, isEdit, loading }: Props) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {isEdit ? 'Edit House' : 'Add New House'}
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          <form onSubmit={async (e) => { e.preventDefault(); await onSubmit(formData); }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input name="name" placeholder="Name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="p-2 rounded-lg border" required />
            <input name="code" placeholder="Code" value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} className="p-2 rounded-lg border" required />
            <input name="cluster" placeholder="Cluster" value={formData.cluster} onChange={e => setFormData({...formData, cluster: e.target.value})} className="p-2 rounded-lg border" />
            <input name="region" placeholder="Region" value={formData.region} onChange={e => setFormData({...formData, region: e.target.value})} className="p-2 rounded-lg border" />
            <input name="wh_region" placeholder="WH Region" value={formData.wh_region} onChange={e => setFormData({...formData, wh_region: e.target.value})} className="p-2 rounded-lg border" />
            <input name="district" placeholder="District" value={formData.district} onChange={e => setFormData({...formData, district: e.target.value})} className="p-2 rounded-lg border" />
            <input name="email" type="email" placeholder="Email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="p-2 rounded-lg border" />
            <input name="address" placeholder="Address" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="p-2 rounded-lg border" />
            <input name="proprietor_name" placeholder="Proprietor Name" value={formData.proprietor_name} onChange={e => setFormData({...formData, proprietor_name: e.target.value})} className="p-2 rounded-lg border" />
            <input name="proprietor_contact" placeholder="Proprietor Contact" value={formData.proprietor_contact} onChange={e => setFormData({...formData, proprietor_contact: e.target.value})} className="p-2 rounded-lg border" />
            <input name="poc_name" placeholder="POC Name" value={formData.poc_name} onChange={e => setFormData({...formData, poc_name: e.target.value})} className="p-2 rounded-lg border" />
            <input name="poc_mobile" placeholder="POC Mobile" value={formData.poc_mobile} onChange={e => setFormData({...formData, poc_mobile: e.target.value})} className="p-2 rounded-lg border" />
            <input name="lifting_date" type="date" placeholder="Lifting Date" value={formData.lifting_date} onChange={e => setFormData({...formData, lifting_date: e.target.value})} className="p-2 rounded-lg border" />
            <input name="latitude" placeholder="Latitude" value={formData.latitude} onChange={e => setFormData({...formData, latitude: e.target.value})} className="p-2 rounded-lg border" />
            <input name="longitude" placeholder="Longitude" value={formData.longitude} onChange={e => setFormData({...formData, longitude: e.target.value})} className="p-2 rounded-lg border" />
            <input name="bts_id" placeholder="BTS ID" value={formData.bts_id} onChange={e => setFormData({...formData, bts_id: e.target.value})} className="p-2 rounded-lg border" />
            <input name="dms_user" placeholder="DMS User" value={formData.dms_user} onChange={e => setFormData({...formData, dms_user: e.target.value})} className="p-2 rounded-lg border" />
            <input name="dms_pass" type="password" placeholder="DMS Pass" value={formData.dms_pass} onChange={e => setFormData({...formData, dms_pass: e.target.value})} className="p-2 rounded-lg border" />
            <input name="dms_house_id" placeholder="DMS House ID" value={formData.dms_house_id} onChange={e => setFormData({...formData, dms_house_id: e.target.value})} className="p-2 rounded-lg border" />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} />
              Active
            </label>
            <button type="submit" className="col-span-1 md:col-span-2 py-2 bg-primary-600 text-white rounded-lg" disabled={loading}>
              {loading ? t('common.processing') : 'Save'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
