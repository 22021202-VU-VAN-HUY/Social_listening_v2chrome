import {
  SentimentResultSchema,
  type SentimentInput,
  type SentimentProvider,
  type SentimentResult,
} from "../schema.js";
import { normalizeAnalysisText } from "../hash.js";

const POSITIVE_TERMS = [
  "tốt",
  "tuyệt",
  "tuyệt vời",
  "xuất sắc",
  "ấn tượng",
  "hữu ích",
  "ủng hộ",
  "thích",
  "hay",
  "hay quá",
  "đáng khen",
  "đáng tin",
  "uy tín",
  "ý nghĩa",
  "tự hào",
  "thành công",
  "minh bạch",
  "chất lượng",
  "positive",
  "great",
  "excellent",
  "love",
];

const NEGATIVE_TERMS = [
  "tệ",
  "kém",
  "thất vọng",
  "phản đối",
  "không ổn",
  "vấn đề",
  "lừa",
  "lừa đảo",
  "gian dối",
  "thiếu minh bạch",
  "đạo nhái",
  "vô nghĩa",
  "đáng ngờ",
  "thất bại",
  "scandal",
  "fake",
  "tiêu cực",
  "negative",
  "bad",
  "poor",
  "hate",
];

const NEGATED_POSITIVE_TERMS = [
  "không tốt",
  "chẳng tốt",
  "không hay",
  "chẳng hay",
  "không đáng tin",
  "không ấn tượng",
  "không minh bạch",
];

const NEGATED_NEGATIVE_TERMS = [
  "không tệ",
  "chẳng tệ",
  "không kém",
  "không thất vọng",
  "không phải lừa đảo",
];

const TOPIC_ALIASES = [
  "vsf",
  "vinsmart future",
  "vinfuture",
  "vin future",
];

function scoreTerms(text: string, terms: readonly string[]): number {
  return terms.reduce((score, term) => {
    let offset = 0;
    let count = 0;
    while ((offset = text.indexOf(term, offset)) >= 0) {
      count += 1;
      offset += term.length;
    }
    return score + count;
  }, 0);
}

function evidenceTerms(text: string, terms: readonly string[]): string[] {
  return [...new Set(terms.filter((term) => text.includes(term)))].slice(0, 4);
}

export class HeuristicSentimentProvider implements SentimentProvider {
  readonly name = "heuristic-development";

  constructor(readonly model: string = "vi-lexicon-v1") {}

  async analyze(input: SentimentInput): Promise<SentimentResult> {
    const entityText = normalizeAnalysisText(input.text).toLocaleLowerCase("vi");
    const contextText = normalizeAnalysisText(
      `${input.postContext ?? ""} ${input.conversationContext ?? ""}`,
    ).toLocaleLowerCase("vi");
    const topicAliases = [
      ...TOPIC_ALIASES,
      normalizeAnalysisText(input.topic).toLocaleLowerCase("vi"),
    ].filter(Boolean);
    const explicitlyTargetsTopic = topicAliases.some((term) =>
      entityText.includes(term),
    );
    const contextTargetsTopic = topicAliases.some((term) =>
      contextText.includes(term),
    );
    const positiveEvidence = evidenceTerms(entityText, POSITIVE_TERMS);
    const negativeEvidence = evidenceTerms(entityText, NEGATIVE_TERMS);
    const negatedPositiveEvidence = evidenceTerms(
      entityText,
      NEGATED_POSITIVE_TERMS,
    );
    const negatedNegativeEvidence = evidenceTerms(
      entityText,
      NEGATED_NEGATIVE_TERMS,
    );
    const hasEntityStance =
      positiveEvidence.length +
        negativeEvidence.length +
        negatedPositiveEvidence.length +
        negatedNegativeEvidence.length >
      0;
    const isRelevant =
      explicitlyTargetsTopic ||
      (input.entityType === "comment" && contextTargetsTopic && hasEntityStance);

    if (!isRelevant) {
      return SentimentResultSchema.parse({
        isRelevant: false,
        label: "neutral",
        confidence: 0.9,
        reason:
          "Không đủ bằng chứng cho thấy nội dung đang bày tỏ thái độ về VinSmart Future/VSF.",
        language: "vi",
      });
    }

    let positive = scoreTerms(entityText, POSITIVE_TERMS);
    let negative = scoreTerms(entityText, NEGATIVE_TERMS);
    positive += scoreTerms(entityText, NEGATED_NEGATIVE_TERMS) * 2;
    negative += scoreTerms(entityText, NEGATED_POSITIVE_TERMS) * 2;

    const label =
      positive === negative
        ? "neutral"
        : positive > negative
          ? "positive"
          : "negative";
    const evidenceCount = positive + negative;
    const confidence =
      label === "neutral"
        ? evidenceCount === 0
          ? 0.55
          : 0.5
        : Math.min(0.95, 0.65 + Math.abs(positive - negative) * 0.1);

    return SentimentResultSchema.parse({
      isRelevant,
      label,
      confidence,
      reason:
        evidenceCount === 0
          ? "Nội dung có liên quan đến VinSmart Future/VSF nhưng không thể hiện thái cực rõ ràng."
          : `Đánh giá VinSmart Future/VSF từ chính nội dung: tín hiệu tích cực ${positive}, tín hiệu tiêu cực ${negative}.`,
      language: "vi",
    });
  }
}
