import { canonicalFacebookUrl, isFacebookUrl } from "../shared/config";

export const FACEBOOK_HOME_URL = "https://www.facebook.com/";
export const FACEBOOK_JOINED_GROUPS_URL =
  "https://www.facebook.com/groups/joins/";

export const RUN_MARKER_KEY = "__listening_social_run";

export function withRunMarker(url: string, runId: string): string {
  if (!isFacebookUrl(url)) {
    throw new Error("Blocked non-Facebook navigation.");
  }
  const parsed = new URL(url);
  parsed.hash = `${RUN_MARKER_KEY}=${encodeURIComponent(runId)}`;
  return parsed.toString();
}

export function readRunMarker(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hash = parsed.hash.replace(/^#/u, "");
    const params = new URLSearchParams(hash);
    const value = params.get(RUN_MARKER_KEY);
    return value && value.length <= 128 ? value : null;
  } catch {
    return null;
  }
}

export function buildGroupSearchUrl(groupUrl: string, keyword: string): string {
  const canonical = canonicalGroupUrl(groupUrl);
  if (!canonical) {
    throw new Error("Invalid Facebook group URL.");
  }

  const parsed = new URL(canonical);
  const match = /^\/groups\/([^/]+)\/?$/u.exec(parsed.pathname);
  const groupKey = match?.[1];
  if (!groupKey) {
    throw new Error("URL is not a canonical Facebook group.");
  }

  const target = new URL(
    `/groups/${encodeURIComponent(decodeURIComponent(groupKey))}/search/`,
    FACEBOOK_HOME_URL
  );
  target.searchParams.set("q", keyword.slice(0, 160));
  return target.toString();
}

export function canonicalPostUrl(value: string): string | null {
  const canonical = canonicalFacebookUrl(value);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  const match =
    /^\/groups\/([^/]+)\/(posts|permalink)\/([^/]+)\/?$/u.exec(
      parsed.pathname
    );
  if (!match?.[1] || !match[2] || !match[3]) return null;
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = `/groups/${match[1]}/${match[2]}/${match[3]}/`;
  return parsed.toString();
}

export function canonicalGroupUrl(value: string): string | null {
  const canonical = canonicalFacebookUrl(value);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  const match = /^\/groups\/([^/]+)\/?$/u.exec(parsed.pathname);
  if (!match?.[1]) return null;
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = `/groups/${match[1]}/`;
  return parsed.toString();
}

export function canonicalCommentUrl(value: string): string | null {
  const canonical = canonicalFacebookUrl(value);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  if (
    !/^\/groups\/[^/]+\/(?:posts|permalink)\/[^/]+\/?$/u.test(
      parsed.pathname
    )
  ) {
    return null;
  }
  const commentId =
    parsed.searchParams.get("comment_id") ??
    parsed.searchParams.get("reply_comment_id");
  if (!commentId || commentId.length > 200) return null;
  return parsed.toString();
}
