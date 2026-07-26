export interface SalesRecord {
  id: number;
  house_id: number;
  product_id: number;
  date: string;
  sold_quantity: number;
  unit_price: number;
  total_sales_amount: number;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  product?: {
    id: number;
    product_name: string;
    product_code: string;
    category: string;
  } | null;
}

export interface SalesSummary {
  total_sold: number;
  total_sales_amount: number;
  entry_count: number;
}

export interface SalesBatchEntry {
  product_id: number;
  sold_quantity: number;
  unit_price: number;
}

export interface ProductOption {
  id: number;
  product_name: string;
  product_code: string;
  category: string;
}
