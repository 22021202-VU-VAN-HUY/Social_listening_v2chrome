export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ??
  "http://localhost:4000/api/v1";

const REQUEST_TIMEOUT_MS = 8_000;
export const ACTIVE_JOB_STORAGE_KEY = "vinlisten.activeJobId";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status = 0, payload: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`,
      {
        ...init,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      },
    );

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const payloadRecord =
        typeof payload === "object" && payload !== null
          ? (payload as Record<string, unknown>)
          : {};
      const nestedError =
        typeof payloadRecord.error === "object" &&
        payloadRecord.error !== null
          ? (payloadRecord.error as Record<string, unknown>)
          : {};
      const detail =
        typeof payloadRecord.message === "string"
          ? payloadRecord.message
          : typeof nestedError.message === "string"
            ? nestedError.message
            : `API trả về mã ${response.status}`;
      throw new ApiError(detail, response.status, payload);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("API phản hồi quá thời gian cho phép.");
    }
    throw new ApiError(
      error instanceof Error ? error.message : "Không thể kết nối API.",
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

export function unwrapData(value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    value.data !== undefined
  ) {
    return value.data;
  }
  return value;
}

export function unwrapItems(value: unknown): unknown[] {
  const data = unwrapData(value);
  if (Array.isArray(data)) return data;
  if (typeof data !== "object" || data === null) return [];

  for (const key of ["items", "results", "records", "jobs", "sources"]) {
    if (key in data && Array.isArray(data[key as keyof typeof data])) {
      return data[key as keyof typeof data] as unknown[];
    }
  }
  return [];
}

export function asRecord(value: unknown): Record<string, unknown> {
  const data = unwrapData(value);
  return typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)
    : {};
}

export function asString(
  value: unknown,
  fallback = "",
): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(
  value: unknown,
  fallback = 0,
): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function asBoolean(
  value: unknown,
  fallback = false,
): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "Chưa có";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatShortTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function saveActiveJobId(id: string): void {
  if (!id) return;
  window.localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, id);
}

export function readActiveJobId(): string | null {
  return window.localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
}

export function clearActiveJobId(id?: string): void {
  const current = readActiveJobId();
  if (!id || current === id) {
    window.localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
  }
}

export function extractId(value: unknown): string {
  const record = asRecord(value);
  const candidate =
    record.id ?? record.jobId ?? record.job_id ?? record.requestId;
  return typeof candidate === "string" || typeof candidate === "number"
    ? String(candidate)
    : "";
}
