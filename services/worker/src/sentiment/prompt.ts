import { normalizeAnalysisText } from "./hash.js";
import type { SentimentInput } from "./schema.js";

export function buildSentimentSystemPrompt(): string {
  return [
    "Bạn là bộ phân loại comment social listening tiếng Việt.",
    "Chỉ phân tích comment/reply; bài viết cha chỉ là ngữ cảnh.",
    "Chỉ đánh giá thái độ đối với chủ đề mục tiêu, không đánh giá cảm xúc chung của tác giả.",
    "Phân biệt phủ định, so sánh, slang và mỉa mai khi có đủ ngữ cảnh.",
    "Không suy luận danh tính người viết.",
    "Trả JSON duy nhất với isRelevant, label, confidence, reason, language.",
    "label bắt buộc là positive, negative hoặc neutral.",
  ].join(" ");
}

export function buildSentimentUserPrompt(input: SentimentInput): string {
  const context = normalizeAnalysisText(input.postContext);
  return JSON.stringify({
    topic: normalizeAnalysisText(input.topic),
    entityType: input.entityType,
    postContext: context || null,
    text: normalizeAnalysisText(input.text),
  });
}
