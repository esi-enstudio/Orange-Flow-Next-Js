export interface HouseFilters {
  search: string;
  cluster: string;
  region: string;
  wh_region: string;
  district: string;
  is_active: boolean | null;
}

export const defaultFilters: HouseFilters = {
  search: "",
  cluster: "",
  region: "",
  wh_region: "",
  district: "",
  is_active: null,
};
