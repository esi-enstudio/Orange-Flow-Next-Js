"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  ClipboardList,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  Undo2,
  Wallet,
} from "lucide-react";
import { toast } from "react-hot-toast";

import axios from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { InventoryStatusBadge } from "@/components/inventory/InventoryStatusBadge";
import { apiError, formatDate, houseHeaders } from "@/components/inventory/helpers";

interface DashboardSale {
  id: number;
  sale_no?: string | null;
  status: string;
  business_date?: string | null;
  total_quantity: number;
  total_amount: number;
  retailer_name?: string | null;
}

interface DashboardData {
  scope: "employee" | "house";
  employee?: {
    id: number;
    employee_name?: string | null;
    employee_type?: string | null;
    dms_code?: string | null;
  } | null;
  today: {
    assigned: number;
    returned: number;
    sold_units: number;
    pending_submissions: number;
    sales_count: number;
    sales_quantity: number;
    sales_amount: number;
  };
  stock: {
    assigned: number;
    returned: number;
    sold: number;
    by_product: {
      product_id: number;
      product_name?: string | null;
      product_code?: string | null;
      assigned: number;
      returned: number;
      sold: number;
    }[];
  };
  recent_sales: DashboardSale[];
}

export default function MyStockPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);

  const canCreateSale = hasPermission("field_sales.create");
  const canReturn = hasPermission("inventory.return");

  const fetchDashboard = useCallback(async () => {
    if (!houseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await axios.get("/v1/sales/dashboard", {
        headers: houseHeaders(houseId),
      });
      setData(res.data.data);
    } catch (err) {
      toast.error(apiError(err, t("field_sales.common.error_generic")).message);
    } finally {
      setLoading(false);
    }
  }, [houseId, t]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (!hasPermission("field_sales.view")) return <AccessDenied />;

  const cards = [
    {
      key: "assigned",
      label: t("field_sales.my_stock.assigned"),
      value: data?.stock.assigned ?? 0,
      icon: PackageCheck,
      tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10",
    },
    {
      key: "sold",
      label: t("field_sales.my_stock.sold"),
      value: data?.stock.sold ?? 0,
      icon: ShoppingBag,
      tone: "text-green-600 bg-green-50 dark:bg-green-500/10",
    },
    {
      key: "returned",
      label: t("field_sales.my_stock.returned"),
      value: data?.stock.returned ?? 0,
      icon: Undo2,
      tone: "text-amber-600 bg-amber-50 dark:bg-amber-500/10",
    },
    {
      key: "pending",
      label: t("field_sales.my_stock.pending"),
      value: data?.today.pending_submissions ?? 0,
      icon: ClipboardList,
      tone: "text-rose-600 bg-rose-50 dark:bg-rose-500/10",
    },
    {
      key: "amount",
      label: t("field_sales.my_stock.sales_amount"),
      value: `৳${(data?.today.sales_amount ?? 0).toFixed(2)}`,
      icon: Wallet,
      tone: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10",
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl">
          <ShoppingBag className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("field_sales.my_stock.title")}
            </h1>
            <PageGuideModal pageKey="field_sales.my_stock" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {data?.employee?.employee_name
              ? `${data.employee.employee_name} • ${data.employee.dms_code ?? ""}`
              : t("field_sales.my_stock.description")}
          </p>
        </div>
        <button
          onClick={fetchDashboard}
          className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
          title={t("field_sales.common.refresh")}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {!houseId ? (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          {t("field_sales.common.require_house")}
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 animate-pulse"
            >
              <div className="h-8 w-8 rounded-xl bg-gray-200 dark:bg-slate-700" />
              <div className="h-6 w-16 bg-gray-200 dark:bg-slate-700 rounded mt-3" />
              <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded mt-2" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {cards.map((card) => (
              <div
                key={card.key}
                className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-3"
              >
                <div className={`inline-flex p-2 rounded-xl ${card.tone}`}>
                  <card.icon className="w-4 h-4" />
                </div>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">
                  {card.value}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{card.label}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {canCreateSale ? (
              <Link
                href="/sales"
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold cursor-pointer"
              >
                <ClipboardList className="w-4 h-4" />
                {t("field_sales.my_stock.open_sales")}
              </Link>
            ) : null}
            {canReturn ? (
              <Link
                href="/inventory/returns"
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ArrowLeftRight className="w-4 h-4" />
                {t("field_sales.my_stock.open_returns")}
              </Link>
            ) : null}
          </div>

          <div className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
              {t("field_sales.my_stock.stock_by_product")}
            </h2>
            {data?.stock.by_product.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="px-2 py-1.5">{t("field_sales.common.product")}</th>
                      <th className="px-2 py-1.5 text-right">{t("inventory.status.assigned")}</th>
                      <th className="px-2 py-1.5 text-right">{t("inventory.status.returned")}</th>
                      <th className="px-2 py-1.5 text-right">{t("field_sales.status.approved")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                    {data.stock.by_product.map((product) => (
                      <tr key={product.product_id}>
                        <td className="px-2 py-1">
                          <p className="font-medium">{product.product_name}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {product.product_code}
                          </p>
                        </td>
                        <td className="px-2 py-1 text-right font-semibold text-indigo-600">
                          {product.assigned}
                        </td>
                        <td className="px-2 py-1 text-right">{product.returned}</td>
                        <td className="px-2 py-1 text-right text-green-600">{product.sold}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("inventory.mother_stock.empty")}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 px-4 pt-3">
              {t("field_sales.my_stock.recent_sales")}
            </h2>
            {data?.recent_sales.length ? (
              <div className="divide-y divide-gray-50 dark:divide-slate-800">
                {data.recent_sales.map((sale) => (
                  <div key={sale.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{sale.sale_no}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {formatDate(sale.business_date)} • {sale.retailer_name || "-"} • {sale.total_quantity}
                      </p>
                    </div>
                    <span className="text-sm font-semibold">{sale.total_amount.toFixed(2)}</span>
                    <InventoryStatusBadge status={sale.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-4 text-xs text-gray-500 dark:text-gray-400">
                {t("field_sales.my_stock.empty_sales")}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
