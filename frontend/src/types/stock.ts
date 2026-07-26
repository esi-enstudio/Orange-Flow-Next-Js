export type StockMode = 'house' | 'employee';

export interface SubcategoryStock {
  subcategory: string;
  quantity: number;
  amount: number;
  product_count: number;
}

export interface CategoryStockSummary {
  category: string;
  total_quantity: number;
  total_amount: number;
  subcategories: SubcategoryStock[];
}

export interface EmployeeStockListItem {
  employee_id: number;
  employee_name: string;
  dms_code: string | null;
  employee_type: string;
  itop_number: string | null;
  pool_number: string | null;
  product_count: number;
  total_quantity: number;
}

export interface ProductStockEntry {
  record_id: number;
  product_id: number;
  product_name: string;
  product_code: string;
  category: string;
  subcategory: string | null;
  quantity: number;
  amount: number;
}

export interface EmployeeStockDetail {
  employee_id: number;
  employee_name: string;
  employee_type: string;
  itop_number: string | null;
  pool_number: string | null;
  products: ProductStockEntry[];
}

export interface StockDashboardSummary {
  categories: CategoryStockSummary[];
  employee_count: number;
}

export interface DailyStockEntry {
  product_id: number;
  product_name: string;
  product_code: string;
  category: string | null;
  subcategory: string | null;
  opening_qty: number;
  quantity_in: number;
  quantity_out: number;
  closing_qty: number;
}

export interface DailyStockResponse {
  date: string;
  mode: string;
  entries: DailyStockEntry[];
}
