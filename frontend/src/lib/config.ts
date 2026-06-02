// Single source of truth for API base URLs + storage keys (was duplicated
// across api.ts, portal.ts, developers/page.tsx, status/changelog pages).
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://15.235.234.216:8081/api").replace(/\/$/, "");
export const API_V1 = `${API_BASE}/v1`;
export const DOCS_URL = `${API_V1}/docs`;

export const ADMIN_TOKEN_KEY = "melbet_token";
export const CUSTOMER_TOKEN_KEY = "zeroapi_customer_token";
export const ADMIN_PROVIDER_KEY = "zeroapi_admin_provider";
