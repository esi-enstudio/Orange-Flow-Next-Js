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
  /** Explicit top-level module keys granted by this plan. null/undefined = legacy (unrestricted). */
  allowed_modules?: string[] | null;
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
  module_gated: boolean;
  features_enabled?: string[] | null;
  limits?: Record<string, any> | null;
  allowed_modules?: string[] | null;
  plan?: Plan | null;
  trial_end?: string | null;
  grace_period_end?: string | null;
  next_billing_date?: string | null;

  /** False when the house may not use the product at all (no plan / expired / deactivated). */
  access_allowed: boolean;
  /** SUBSCRIPTION_REQUIRED | SUBSCRIPTION_EXPIRED | HOUSE_INACTIVE (null = allowed). */
  access_code?: string | null;
  /** English backend message naming the house/plan; the UI localises by `access_code`. */
  access_message?: string | null;
  /** Suggested next step: select_plan | renew | contact_admin. */
  access_action?: string | null;
  house_name?: string | null;
  house_code?: string | null;
  plan_name?: string | null;
  plan_status?: string | null;
  plan_end_date?: string | null;
  days_remaining?: number | null;
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
  invoice_no?: string | null;
  amount: number;
  currency: string;
  status: string;
  /** Manual payment channel: cash | manual | bank | bkash | nagad | ... */
  gateway?: string | null;
  gateway_tran_id?: string | null;
  /** Reference / transaction ID supplied by the tenant. */
  reference?: string | null;
  note?: string | null;
  rejection_reason?: string | null;
  /** Reviewer's message when a payment was flagged as needing more information. */
  info_request_reason?: string | null;
  info_requested_at?: string | null;
  has_proof?: boolean;
  proof_name?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
}

export interface PaymentMethod {
  id: number;
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

/** Why a house is blocked from the product (deny-by-default access policy). */
export type HouseAccessCode =
  | "SUBSCRIPTION_REQUIRED"
  | "SUBSCRIPTION_EXPIRED"
  | "HOUSE_INACTIVE";

/** Everything the gate needs to explain a block to the user. */
export interface HouseAccessBlock {
  code: HouseAccessCode;
  houseId?: number | null;
  houseName?: string | null;
  houseCode?: string | null;
  planName?: string | null;
  planStatus?: string | null;
  planEndDate?: string | null;
  daysRemaining?: number | null;
  /** select_plan | renew | contact_admin */
  action?: string | null;
  /** English backend fallback message (UI localises by `code`). */
  message?: string | null;
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