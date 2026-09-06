const RAW_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:5000");

export const API_ORIGIN = RAW_API_BASE.replace(/\/api\/?$/, "").replace(/\/$/, "");
export const API_ROOT = `${API_ORIGIN}/api`;
export const API_BASE = API_ROOT;
export const USER_API = `${API_ROOT}/users`;
