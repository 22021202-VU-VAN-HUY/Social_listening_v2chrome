const SAFE_SHORTCODE = /^[A-Za-z0-9_-]{1,200}$/u;

export function extractThreadsShortcode(
  shortcode: string | undefined,
  permalink: string,
): string | null {
  if (shortcode && SAFE_SHORTCODE.test(shortcode)) return shortcode;
  try {
    const url = new URL(permalink);
    if (!new Set(["threads.net", "www.threads.net", "threads.com", "www.threads.com"]).has(url.hostname.toLowerCase())) {
      return null;
    }
    const match = url.pathname.match(/\/(?:post|t)\/([A-Za-z0-9_-]{1,200})(?:\/|$)/u);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function canonicalThreadsPostUrl(
  shortcode: string | undefined,
  permalink: string,
): string | null {
  const safeShortcode = extractThreadsShortcode(shortcode, permalink);
  return safeShortcode
    ? `https://www.threads.com/t/${safeShortcode}/`
    : null;
}
