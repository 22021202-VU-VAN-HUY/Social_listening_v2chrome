import { createHash } from "node:crypto";
import type { SentimentInput } from "./schema.js";

export const PROMPT_VERSION = "vsf-conversation-segment-workplace-v4";
export const ANALYSIS_SCHEMA_VERSION = "sentiment-input-v4";
export const NORMALIZATION_VERSION = "unicode-nfkc-topic-alias-v2";

export function normalizeAnalysisText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

export function createAnalysisInputHash(input: SentimentInput): string {
  const canonicalInput = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
    promptVersion: PROMPT_VERSION,
    entityType: input.entityType,
    text: normalizeAnalysisText(input.text),
    postContext: normalizeAnalysisText(input.postContext),
    conversationContext: normalizeAnalysisText(input.conversationContext),
    topic: normalizeAnalysisText(input.topic),
  };

  return createHash("sha256")
    .update(JSON.stringify(canonicalInput))
    .digest("hex");
}
