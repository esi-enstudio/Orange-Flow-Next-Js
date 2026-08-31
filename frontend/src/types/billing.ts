export interface Plan {
  id: number;
  name: string;
  slug?: string | null;
  tier?: string | null;
  duration_days?: number | null;
  price?: number | null;
  currency: string;
  billing_interval: string;
  price_monthly: number;
  price_yearly: number;
  trial_days: number;
  description?: string | null;
  features?: string | null;
  feature_flags?: string[] | null;
  limits?: Record<string, any> | null;
  is_active: boolean;
  sort_order: number;
}

export interface Subscription {
  id: number;
  house_id: number;
  package_id?: number | null;
  status: string;
  effective_status?: string | null;
  start_date: string;
  end_date: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  trial_start?: string | null;
  trial_end?: string | null;
  grace_period_end?: string | null;
  cancel_at_period_end: boolean;
  cancelled_at?: string | null;
  paused_at?: string | null;
  resume_at?: string | null;
  auto_renew: boolean;
  gateway?: string | null;
  billing_interval: string;
  currency: string;
  package?: Plan | null;
  house_name?: string | null;
}

export interface Entitlements {
  house_id: number;
  subscribed: boolean;
  status?: string | null;
  feature_gated: boolean;
  features_enabled?: string[] | null;
  limits?: Record<string, any> | null;
  plan?: Plan | null;
  trial_end?: string | null;
  grace_period_end?: string | null;
  next_billing_date?: string | null;
}

export interface Invoice {
  id: number;
  invoice_no: string;
  amount: number;
  tax: number;
  total: number;
  currency: string;
  status: string;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  due_date?: string | null;
  paid_at?: string | null;
  description?: string | null;
  created_at?: string | null;
}

export interface Payment {
  id: number;
  invoice_id: number;
  amount: number;
  currency: string;
  status: string;
  gateway?: string | null;
  gateway_tran_id?: string | null;
  card_type?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
}

export interface PaymentMethod {
  id?: number;
  method_type: string;
  label?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  bank_name?: string | null;
  routing_number?: string | null;
  bkash_number?: string | null;
  nagad_number?: string | null;
  instructions?: string | null;
  is_active?: boolean;
}

export interface HouseOption {
  id: number;
  name: string;
  code: string;
  display_name?: string;
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface Paginated<T> {
  success: boolean;
  data: T[];
  pagination: PaginationMeta;
}

export interface BillingOverview {
  house_id: number;
  house_name?: string | null;
  effective_status?: string | null;
  plan_name?: string | null;
  billing_interval?: string | null;
  next_billing_date?: string | null;
  total_received: number;
  unpaid_invoices: number;
  amount_due_now: number;
}