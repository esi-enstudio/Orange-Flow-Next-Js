import axios from "axios";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Response interceptor for consistent error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    let message = "Something went wrong";
    const detail = error.response?.data?.detail;
    
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      // Handle FastAPI validation errors
      message = detail.map((err: any) => err.msg).join(", ");
    } else if (error.message) {
      message = error.message;
    }
    
    console.error("API Error:", message);
    return Promise.reject(error);
  }
);

export default apiClient;
