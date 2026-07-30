const DEFAULT_API_BASE_URL =
  import.meta.env["VITE_API_BASE_URL"]?.trim() ||
  "http://localhost:4000/api/v1";

const DEFAULT_WEB_ORIGINS = [
  "http://localhost",
  "http://127.0.0.1",
  "https://listening-socialmediav2.m-ilestyler431554.chatgpt.site"
] as const;

export function normalizeApiBaseUrl(input: string): string {
  const parsed = new URL(input.trim());
  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("API URL không được chứa credential, query hoặc fragment.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
    throw new Error("API production phải dùng HTTPS.");
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, "")}`;
}

export function getDefaultApiBaseUrl(): string {
  return normalizeApiBaseUrl(DEFAULT_API_BASE_URL);
}

export function isAllowedExternalSender(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const origin = new URL(url).origin;
    return DEFAULT_WEB_ORIGINS.includes(
      origin as (typeof DEFAULT_WEB_ORIGINS)[number]
    );
  } catch {
    return false;
  }
}

export function isSafeJobId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/u.test(value)
  );
}

export function isFacebookUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "www.facebook.com" ||
        parsed.hostname === "web.facebook.com")
    );
  } catch {
    return false;
  }
}

export function canonicalFacebookUrl(value: string): string | null {
  try {
    const parsed = new URL(value, "https://www.facebook.com/");
    if (
      parsed.protocol !== "https:" ||
      (parsed.hostname !== "www.facebook.com" &&
        parsed.hostname !== "web.facebook.com")
    ) {
      return null;
    }

    parsed.hostname = "www.facebook.com";
    parsed.hash = "";
    const retained = new URLSearchParams();
    for (const key of ["comment_id", "reply_comment_id"]) {
      const entry = parsed.searchParams.get(key);
      if (entry) {
        retained.set(key, entry);
      }
    }
    parsed.search = retained.toString();
    parsed.pathname = parsed.pathname.replace(/\/{2,}/gu, "/");
    return parsed.toString();
  } catch {
    return null;
  }
}
