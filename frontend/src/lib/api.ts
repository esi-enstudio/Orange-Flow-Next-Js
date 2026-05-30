import axios from "axios";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api",
});

// Request interceptor to add house context
apiClient.interceptors.request.use(
  (config) => {
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
      message = detail.map((err: any) => {
        if (typeof err === 'string') return err;
        const path = err.loc ? err.loc.join('.') : '';
        const msg = err.msg || 'Unknown error';
        return path ? `${path}: ${msg}` : msg;
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
