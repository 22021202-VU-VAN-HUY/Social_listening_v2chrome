export function normalizeKeyword(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("vi")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function keywordMatches(
  text: string,
  keyword: {
    value: string;
    matchMode: "whole_word" | "contains_phrase";
  },
): boolean {
  const haystack = normalizeKeyword(text);
  const needle = normalizeKeyword(keyword.value);
  if (!needle) {
    return false;
  }
  if (keyword.matchMode === "contains_phrase") {
    return haystack.includes(needle);
  }
  return new RegExp(
    `(^|[^\\p{L}\\p{M}\\p{N}_])${escapeRegExp(needle)}($|[^\\p{L}\\p{M}\\p{N}_])`,
    "iu",
  ).test(haystack);
}
