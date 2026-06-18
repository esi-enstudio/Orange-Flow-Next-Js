import axios from "axios";
import Cookies from "js-cookie";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api",
});

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

export function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = API_BASE.replace(/\/api\/?$/, "");
  return `${base}${path}`;
}

// Request interceptor to attach auth token from cookies
apiClient.interceptors.request.use(
  (config) => {
    const token = Cookies.get("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for consistent error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    let message = "Something went wrong";
    const detail = error.response?.data?.detail;
    
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      // Handle FastAPI validation errors (Pydantic v2 style)
      message = detail.map((err: unknown) => {
        if (typeof err === 'string') return err;
        if (typeof err === 'object' && err !== null) {
          const e = err as Record<string, unknown>;
          const path = e.loc ? (e.loc as string[]).join('.') : '';
          const msg = e.msg || 'Unknown error';
          return path ? `${path}: ${msg}` : String(msg);
        }
        return 'Unknown error';
      }).join(", ");
    } else if (detail && typeof detail === 'object') {
      // Handle case where detail is a single object
      message = detail.msg || JSON.stringify(detail);
    } else if (error.message) {
      message = error.message;
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;
