import { getAccessToken } from "./auth.js";
import { getBipEnv } from "./env.js";

const PRODUCTION_API_BASE = "https://app.bipintelligence.com/open-api";
const SANDBOX_API_BASE = "https://sandbox.bipintelligence.com/open-api";

function apiBase(): string {
  return getBipEnv() === "sandbox" ? SANDBOX_API_BASE : PRODUCTION_API_BASE;
}

export interface BipResponse<T = unknown> {
  data: T;
  rateLimitRemaining: string | null;
}

interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

async function bipRequest<T = unknown>(
  path: string,
  { method = "GET", query, body }: RequestOptions = {},
): Promise<BipResponse<T>> {
  const token = await getAccessToken();
  const url = new URL(apiBase() + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const rateLimitRemaining = res.headers.get("X-Rate-Limit-Remaining");
  const rawText = await res.text();
  let parsed: unknown = undefined;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        `BiP API unauthorized (401): access token expired/invalid, or the caller's IP is not on this token's allow-list. ${rawText}`,
      );
    }
    if (res.status === 429) {
      throw new Error(
        `BiP API rate limited (429): daily call limit reached (Open API Core = 10 successful calls/day). ${rawText}`,
      );
    }
    throw new Error(`BiP API error (${res.status}): ${rawText}`);
  }

  return { data: parsed as T, rateLimitRemaining };
}

export interface PagingParams {
  page?: number;
  size?: number;
}

// --- Notices --------------------------------------------------------------

export function searchNotices(criteria: Record<string, unknown> = {}) {
  return bipRequest("/notices", { method: "POST", body: criteria });
}

export function getNotice(id: number | string) {
  return bipRequest(`/notices/${encodeURIComponent(String(id))}`);
}

// --- Awards -----------------------------------------------------------------

export function searchAwards(criteria: Record<string, unknown> = {}) {
  return bipRequest("/awards", { method: "POST", body: criteria });
}

export function getAward(id: number | string) {
  return bipRequest(`/awards/${encodeURIComponent(String(id))}`);
}

// --- Spend ------------------------------------------------------------------

export function listSpendBuyers(paging: PagingParams = {}) {
  return bipRequest("/spend/buyers", { query: { ...paging } });
}

export function listSpendSuppliers(paging: PagingParams = {}) {
  return bipRequest("/spend/suppliers", { query: { ...paging } });
}

export interface SpendTransactionsCriteria extends PagingParams {
  buyerName?: string;
  supplierName?: string;
  dateFrom?: string;
  dateTo?: string;
  [key: string]: unknown;
}

export function searchSpendTransactions(criteria: SpendTransactionsCriteria = {}) {
  return bipRequest("/spend/transactions", { method: "POST", body: criteria });
}
