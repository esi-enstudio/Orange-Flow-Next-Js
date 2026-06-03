"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import apiClient, { resolveImageUrl } from "@/lib/api";

interface Brand {
  app_name: string;
  logo: string | null;
}

interface BrandContextType {
  brand: Brand;
  refreshBrand: () => void;
  updateBrand: (b: Brand) => void;
}

const BrandContext = createContext<BrandContextType>({
  brand: { app_name: "OrangeFlow", logo: null },
  refreshBrand: () => {},
  updateBrand: () => {},
});

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<Brand>({ app_name: "OrangeFlow", logo: null });

  const fetchBrand = () => {
    apiClient.get("settings/brand").then(res => {
      setBrand({ ...res.data, logo: resolveImageUrl(res.data.logo) });
    }).catch(() => {});
  };

  useEffect(() => { fetchBrand(); }, []);

  return (
    <BrandContext.Provider value={{ brand, refreshBrand: fetchBrand, updateBrand: setBrand }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
