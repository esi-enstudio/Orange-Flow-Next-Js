"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Store, Package, Hash, Smartphone, CalendarDays, DollarSign } from "lucide-react";
import apiClient from "@/lib/api";

interface DetailRecord {
  retailer_code: string;
  retailer_name: string;
  activation_time: string;
  product_code: string;
  product_name: string;
  sim_no: string;
  msisdn: string;
  dh_lifting_date: string;
  issue_date: string;
  selling_price: string;
  subscription_type: string;
  service_class: string;
}

interface ProductGroup {
  product_code: string;
  product_name: string;
  count: number;
  records: DetailRecord[];
}

interface RetailerGroup {
  retailer_code: string;
  retailer_name: string;
  count: number;
  products: ProductGroup[];
}

interface DetailData {
  employee: { id: number; name: string; assisted_code: string | null };
  groups: RetailerGroup[];
  total_count: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  employeeId: number | null;
  roleType: "rso" | "bp";
  employeeName: string;
  houseId: number;
}

const RECORD_FIELDS = [
  { key: "activation_time", label: "Act. Time", icon: CalendarDays },
  { key: "sim_no", label: "SIM No.", icon: Smartphone },
  { key: "msisdn", label: "MSISDN", icon: Hash },
  { key: "selling_price", label: "Price", icon: DollarSign },
  { key: "dh_lifting_date", label: "DH Lifting", icon: CalendarDays },
  { key: "issue_date", label: "Issue Date", icon: CalendarDays },
  { key: "subscription_type", label: "Sub Type", icon: Package },
  { key: "service_class", label: "Svc Class", icon: Package },
];

export default function RsoDetailModal({ open, onClose, employeeId, roleType, employeeName, houseId }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DetailData | null>(null);

  useEffect(() => {
    if (!open || !employeeId) { setData(null); return; }
    setLoading(true);
    apiClient
      .get("/reports/live-activations/live-activations-details", {
        params: { employee_id: employeeId, role_type: roleType, house_id: houseId },
      })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, employeeId, roleType, houseId]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-4 pb-4 px-4 sm:pt-8 overflow-y-auto bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="relative w-full max-w-6xl bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {roleType === "rso" ? "RSO" : "BP"} Details — {employeeName}
                </h2>
                {data && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {data.total_count} activations
                    {data.employee.assisted_code && ` · Assisted Code: ${data.employee.assisted_code}`}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6 max-h-[calc(100vh-12rem)] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
                </div>
              ) : !data || data.groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <Store className="w-12 h-12 mb-3 opacity-50" />
                  <p className="text-sm">No activation records found for this period</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {data.groups.map((group) => (
                    <div
                      key={group.retailer_code}
                      className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden"
                    >
                      <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700">
                        <Store className="w-4 h-4 text-primary-500 shrink-0" />
                        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                          {group.retailer_code}
                        </span>
                        {group.retailer_name && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">— {group.retailer_name}</span>
                        )}
                        <span className="ml-auto text-xs font-medium text-gray-500 dark:text-gray-400">
                          {group.count} record{group.count !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
                        {group.products.map((product) => (
                          <div key={product.product_code}>
                            <div className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-800/50">
                              <Package className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                {product.product_code}
                              </span>
                              {product.product_name && (
                                <span className="text-xs text-gray-400">— {product.product_name}</span>
                              )}
                              <span className="ml-auto text-xs text-gray-400">{product.count} record{product.count !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs border-collapse">
                                <thead>
                                  <tr className="bg-gray-50 dark:bg-slate-800/30">
                                    {RECORD_FIELDS.map((f) => (
                                      <th key={f.key} className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700 whitespace-nowrap">
                                        {f.label}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {product.records.map((rec, i) => (
                                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-700/20">
                                      {RECORD_FIELDS.map((f) => (
                                        <td key={f.key} className="px-3 py-2 text-gray-700 dark:text-gray-300 border-b border-gray-50 dark:border-slate-700/30 whitespace-nowrap">
                                          {(rec as unknown as Record<string, string>)[f.key] || "—"}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
