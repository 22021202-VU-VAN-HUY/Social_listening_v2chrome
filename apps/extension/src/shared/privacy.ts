import type { SafeAuthorDto } from "./types";

const FORBIDDEN_NORMALIZED_KEYS = new Set([
  "authorid",
  "authorprofileurl",
  "facebookuserid",
  "handle",
  "platformauthorid",
  "platformuserid",
  "profileid",
  "profileurl",
  "userid",
  "username"
]);

const HANDLE_ONLY_PATTERN = /^@[a-z0-9._-]{1,80}$/iu;
const URL_LIKE_PATTERN =
  /(?:https?:\/\/|www\.|facebook\.com\/|fb\.com\/|\/profile\.php(?:\?|$))/iu;

function normalizeKey(key: string): string {
  return key.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
}

export function sanitizeAuthorName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/gu, " ").trim().slice(0, 160);
  if (
    normalized.length === 0 ||
    HANDLE_ONLY_PATTERN.test(normalized) ||
    URL_LIKE_PATTERN.test(normalized) ||
    /^\d{6,}$/u.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function makeSafeAuthor(
  rawDisplayName: unknown,
  isAnonymous: boolean
): SafeAuthorDto {
  if (isAnonymous) {
    return {
      authorName: null,
      isAnonymous: true,
      authorKind: "anonymous"
    };
  }

  const authorName = sanitizeAuthorName(rawDisplayName);
  return {
    authorName,
    isAnonymous: false,
    authorKind: authorName === null ? "unknown" : "real"
  };
}

/**
 * Runtime boundary used immediately before every backend write.
 * It rejects forbidden identity keys at any nesting depth, including snake_case.
 */
export function assertPrivacySafePayload(
  value: unknown,
  path = "$",
  seen = new WeakSet<object>()
): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    throw new Error(`Circular payload at ${path}`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertPrivacySafePayload(item, `${path}[${String(index)}]`, seen);
    });
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_NORMALIZED_KEYS.has(normalizeKey(key))) {
      throw new Error(`Privacy-forbidden key at ${path}.${key}`);
    }
    assertPrivacySafePayload(child, `${path}.${key}`, seen);
  }
}

export function containsPrivacyForbiddenKey(value: unknown): boolean {
  try {
    assertPrivacySafePayload(value);
    return false;
  } catch {
    return true;
  }
}
