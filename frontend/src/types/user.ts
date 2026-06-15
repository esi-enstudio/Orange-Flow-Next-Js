export interface Role {
  id: number;
  name: string;
}

export interface House {
  id: number;
  name: string;
  code: string;
}

export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  phone_number?: string;
  telegram_id?: number | string;
  status: string;
  roles?: Role[];
  houses?: House[];
  parent_id?: number;
  created_at?: string;
}

export interface UserFilters {
  search: string;
  status: string;
  role_ids: number[];
  house_ids: number[];
  parent_id: number | null;
  phone_number: string;
  telegram_id: string;
  has_employee_profile: boolean | null;
  created_from: string;
  created_to: string;
  updated_from: string;
  updated_to: string;
}
