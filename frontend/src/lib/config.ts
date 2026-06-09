// Single source of truth for API base URLs + storage keys. Every other module
// (api.ts, portal.ts, status/changelog/developers pages) imports from here —
// do NOT re-inline the base URL elsewhere.
// Override per-deployment with NEXT_PUBLIC_API_URL (e.g. https://api.zeroapi.example/api).
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081/api").replace(/\/$/, "");
export const API_V1 = `${API_BASE}/v1`;
export const DOCS_URL = `${API_V1}/docs`;

export const ADMIN_TOKEN_KEY = "melbet_token";
export const CUSTOMER_TOKEN_KEY = "zeroapi_customer_token";
export const ADMIN_PROVIDER_KEY = "zeroapi_admin_provider";
