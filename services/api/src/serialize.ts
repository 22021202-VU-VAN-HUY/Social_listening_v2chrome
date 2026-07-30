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
}): {
  authorName: string | null;
  isAnonymous: boolean;
  authorKind: "real" | "anonymous" | "unknown";
} {
  return {
    authorName: row.author_kind === "real" ? row.author_name : null,
    isAnonymous: row.is_anonymous,
    authorKind: row.author_kind,
  };
}
