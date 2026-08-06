import { normalizeAnalysisText } from "./hash.js";

export const TOPIC_ALIASES = [
  "VinSmart Future",
  "VSF",
  "VinFuture",
  "Vin Future",
] as const;

export const TOPIC_VARIANT_EXAMPLES = [
  "V.S.F",
  "V S F",
  "vi ét ép",
  "vê ét ép",
  "vờ sờ phờ",
  "Vin Smat Future",
  "Vin Sờ Mát Phiu Chờ",
  "Vin Smart Phiu Chờ",
] as const;

interface TopicPattern {
  label: string;
  pattern: RegExp;
}

const TOPIC_PATTERNS: readonly TopicPattern[] = [
  {
    label: "VSF",
    pattern: /(?:^|[^a-z0-9])v[\s._/-]*s[\s._/-]*f(?:$|[^a-z0-9])/u,
  },
  {
    label: "VSF-phonetically-spelled",
    pattern: /\b(?:vi|ve|vo)\s+(?:et|so)\s+(?:ep|pho)\b/u,
  },
  {
    label: "VinSmart-Future-variant",
    pattern:
      /\bvin\s*(?:smart|smat|so\s*mat|xo\s*mat)\s*(?:future|fiu\s*cho|phiu\s*cho)\b/u,
  },
  {
    label: "VinFuture-variant",
    pattern: /\bvin\s*(?:future|fiu\s*cho|phiu\s*cho)\b/u,
  },
];

export function normalizeForTopicMatching(
  value: string | null | undefined,
): string {
  return normalizeAnalysisText(value)
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/gu, "d")
    .replace(/[‐‑‒–—]/gu, "-");
}

export function findTopicReferences(
  value: string | null | undefined,
): string[] {
  const normalized = normalizeForTopicMatching(value);
  if (!normalized) return [];

  return TOPIC_PATTERNS.filter(({ pattern }) => pattern.test(normalized)).map(
    ({ label }) => label,
  );
}

export function containsTopicReference(
  value: string | null | undefined,
): boolean {
  return findTopicReferences(value).length > 0;
}
