import type { Author } from "@listening-social/contracts";
import { ApiError } from "./errors.js";

const trackingParameters = new Set([
  "__cft__",
  "__tn__",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "refid",
  "tracking",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
]);

const profilePathPatterns = [
  /^\/profile\.php$/i,
  /^\/people\//i,
  /^\/user\//i,
  /^\/@[A-Za-z0-9_.-]+\/?$/i,
];

const forbiddenIdentityKeys = /(?:author|user|member|profile).*(?:id|url|link)|(?:username|handle)|(?:author_id|user_id|profile_url)/iu;

export function sanitizeContentUrl(rawUrl: string | null | undefined): string | null {
  if (rawUrl == null) {
    return null;
  }
  const url = new URL(rawUrl);
  if (profilePathPatterns.some((pattern) => pattern.test(url.pathname))) {
    throw new Error("Profile and user-tracking URLs are not accepted");
  }
  for (const parameter of [...url.searchParams.keys()]) {
    if (
      trackingParameters.has(parameter.toLowerCase()) ||
      parameter.toLowerCase().startsWith("utm_")
    ) {
      url.searchParams.delete(parameter);
    }
  }
  url.hash = "";
  return url.toString();
}

function isFacebookHost(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase("en-US");
  return normalized === "facebook.com" || normalized.endsWith(".facebook.com");
}

function facebookPathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

function invalidFacebookUrl(code: string, message: string): never {
  throw new ApiError(400, code, message);
}

export function sanitizeFacebookGroupUrl(rawUrl: string): string {
  let canonicalUrl: string | null;
  try {
    canonicalUrl = sanitizeContentUrl(rawUrl);
  } catch {
    return invalidFacebookUrl(
      "INVALID_FACEBOOK_GROUP_URL",
      "Source URL must identify a Facebook group",
    );
  }
  if (!canonicalUrl) {
    return invalidFacebookUrl(
      "INVALID_FACEBOOK_GROUP_URL",
      "Source URL must identify a Facebook group",
    );
  }
  const url = new URL(canonicalUrl);
  const segments = facebookPathSegments(url);
  if (
    !isFacebookHost(url.hostname) ||
    segments.length !== 2 ||
    segments[0]?.toLocaleLowerCase("en-US") !== "groups" ||
    !segments[1]
  ) {
    return invalidFacebookUrl(
      "INVALID_FACEBOOK_GROUP_URL",
      "Source URL must use facebook.com/groups/{group}",
    );
  }
  url.pathname = `/groups/${segments[1]}`;
  url.search = "";
  return url.toString();
}

export function sanitizeFacebookContentUrl(
  rawUrl: string | null | undefined,
): string | null {
  if (rawUrl == null) {
    return null;
  }
  let canonicalUrl: string | null;
  try {
    canonicalUrl = sanitizeContentUrl(rawUrl);
  } catch {
    return invalidFacebookUrl(
      "INVALID_FACEBOOK_CONTENT_URL",
      "Content URL must identify a Facebook group post or permalink",
    );
  }
  if (!canonicalUrl) {
    return invalidFacebookUrl(
      "INVALID_FACEBOOK_CONTENT_URL",
      "Content URL must identify a Facebook group post or permalink",
    );
  }
  const url = new URL(canonicalUrl);
  const segments = facebookPathSegments(url);
  const entityKind = segments[2]?.toLocaleLowerCase("en-US");
  if (
    !isFacebookHost(url.hostname) ||
    segments.length !== 4 ||
    segments[0]?.toLocaleLowerCase("en-US") !== "groups" ||
    !segments[1] ||
    (entityKind !== "posts" && entityKind !== "permalink") ||
    !segments[3]
  ) {
    return invalidFacebookUrl(
      "INVALID_FACEBOOK_CONTENT_URL",
      "Content URL must use a Facebook group post or permalink path",
    );
  }
  url.pathname = `/groups/${segments[1]}/${entityKind}/${segments[3]}`;
  return url.toString();
}

/**
 * Deliberately returns a closed shape. Even if an untyped caller passes extra
 * identifiers, only a display name and anonymous classification reach SQL.
 */
export function authorForStorage(author: Author): {
  authorName: string | null;
  isAnonymous: boolean;
  authorKind: "real" | "anonymous" | "unknown";
} {
  return {
    authorName: author.authorKind === "real" ? author.authorName : null,
    isAnonymous: author.authorKind === "anonymous",
    authorKind: author.authorKind,
  };
}

export function assertNoIdentityTrackingFields(
  value: unknown,
  path = "payload",
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertNoIdentityTrackingFields(child, `${path}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenIdentityKeys.test(key)) {
      throw new ApiError(
        400,
        "FORBIDDEN_IDENTITY_FIELD",
        `Forbidden identity-tracking field at ${path}.${key}`,
      );
    }
    assertNoIdentityTrackingFields(child, `${path}.${key}`);
  }
}
