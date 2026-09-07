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
    const data = error.response?.data;
    const detail = data?.detail;
    let message = "Something went wrong";

    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      // Handle FastAPI validation errors (Pydantic v2 style)
      data._fieldErrors = detail;
      const parts = detail.map((err: unknown) => {
        if (typeof err === 'string') return err;
        if (typeof err === 'object' && err !== null) {
          const e = err as Record<string, unknown>;
          const loc = Array.isArray(e.loc) ? (e.loc as unknown[]).filter(x => x !== 'body').join('.') : '';
          const msg = e.msg || 'Unknown error';
          return loc ? `${loc}: ${msg}` : msg;
        }
        return 'Unknown error';
      });
      message = parts.join("; ");
      data.detail = message;
    } else if (detail && typeof detail === "object") {
      // Handle structured backend errors: { code, message, error_code, fields }
      const d = detail as Record<string, unknown>;
      if (d.fields && typeof d.fields === "object") {
        data._fieldErrors = d.fields;
      }
      const code =
        typeof d.error_code === "string" ? d.error_code :
        typeof d.code === "string" ? d.code : "";
      message = (typeof d.message === "string" && d.message) ||
                (typeof d.msg === "string" && d.msg) ||
                JSON.stringify(d);
      data.detail = message;
      if (code) data.error_code = code;
    } else if (data?.error && typeof data.error === "object") {
      // Handle the global handler envelope: { success:false, error:{ code, message } }
      const e = data.error as Record<string, unknown>;
      message = (typeof e.message === "string" && e.message) ||
                (typeof e.msg === "string" && e.msg) ||
                "Something went wrong";
      data.detail = message;
      if (typeof e.code === "string") data.error_code = e.code;
    } else if (error.message) {
      message = error.message;
    }

    error.message = message;
    return Promise.reject(error);
  }
);

export default apiClient;
