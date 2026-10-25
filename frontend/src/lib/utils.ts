import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { API_BASE } from "@/lib/api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getProfilePicUrl(path: string | null | undefined) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = API_BASE.replace(/\/api\/?$/, "").replace(/\/$/, "");
  const imagePath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${imagePath}`;
}
