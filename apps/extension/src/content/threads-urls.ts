const THREADS_HOSTS = new Set([
  "threads.com",
  "www.threads.com",
  "threads.net",
  "www.threads.net"
]);

const SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;

export const THREADS_HOME_URL = "https://www.threads.com/";
export const THREADS_SEARCH_SOURCE_URL = "https://www.threads.com/search";

export function isThreadsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && THREADS_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function threadsShortcode(value: string): string | null {
  try {
    const parsed = new URL(value, THREADS_HOME_URL);
    if (!THREADS_HOSTS.has(parsed.hostname)) return null;
    const match = /\/(?:post|t)\/([A-Za-z0-9_-]{1,200})(?:\/|$)/u.exec(
      parsed.pathname
    );
    return match?.[1] && SHORTCODE_PATTERN.test(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

export function canonicalThreadsPostUrl(value: string): string | null {
  const shortcode = threadsShortcode(value);
  return shortcode ? `https://www.threads.com/t/${shortcode}/` : null;
}

export function canonicalThreadsSourceUrl(value: string): string | null {
  try {
    const parsed = new URL(value, THREADS_HOME_URL);
    if (!THREADS_HOSTS.has(parsed.hostname) || parsed.pathname !== "/search") {
      return null;
    }
    return THREADS_SEARCH_SOURCE_URL;
  } catch {
    return null;
  }
}

export function buildThreadsSearchUrl(keyword: string): string {
  const target = new URL("/search", THREADS_HOME_URL);
  target.searchParams.set("q", keyword.slice(0, 160));
  target.searchParams.set("serp_type", "default");
  target.searchParams.set("filter", "recent");
  return target.toString();
}
