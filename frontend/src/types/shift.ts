export interface Shift {
  id: number;
  house_id: number;
  name: string;
  name_bn: string | null;
  start_time: string;
  end_time: string;
  grace_period_minutes: number;
  min_work_hours: number;
  is_active: boolean;
}

export interface MyShift {
  shift_id: number | null;
  shift_name: string | null;
  start_time: string | null;
  end_time: string | null;
  grace_period_minutes: number;
}
