export function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function authorFromRow(row: {
  author_name: string | null;
  is_anonymous: boolean;
  author_kind: "real" | "anonymous" | "unknown";
  anonymous_avatar_variant?: number | null;
}): {
  authorName: string | null;
  isAnonymous: boolean;
  authorKind: "real" | "anonymous" | "unknown";
  anonymousAvatarVariant?: number;
} {
  return {
    authorName: row.author_kind === "real" ? row.author_name : null,
    isAnonymous: row.is_anonymous,
    authorKind: row.author_kind,
    ...(row.author_kind === "anonymous" &&
    row.anonymous_avatar_variant !== null &&
    row.anonymous_avatar_variant !== undefined
      ? { anonymousAvatarVariant: row.anonymous_avatar_variant }
      : {}),
  };
}
