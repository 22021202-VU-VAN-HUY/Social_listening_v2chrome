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
  "xuất sắc",
  "ấn tượng",
  "hữu ích",
  "ủng hộ",
  "thích",
  "hay",
  "đáng khen",
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
  "không tốt",
  "không ổn",
  "vấn đề",
  "lừa",
  "tiêu cực",
  "negative",
  "bad",
  "poor",
  "hate",
];

const TOPIC_ALIASES = [
  "vsf",
  "vinsmart future",
  "vinfuture",
  "vin future",
];

function scoreTerms(text: string, terms: readonly string[]): number {
  return terms.reduce(
    (score, term) => score + (text.includes(term) ? 1 : 0),
    0,
  );
}

export class HeuristicSentimentProvider implements SentimentProvider {
  readonly name = "heuristic-development";

  constructor(readonly model: string = "vi-lexicon-v1") {}

  async analyze(input: SentimentInput): Promise<SentimentResult> {
    const text = normalizeAnalysisText(
      `${input.postContext ?? ""} ${input.text}`,
    ).toLocaleLowerCase("vi");
    const isRelevant = TOPIC_ALIASES.some((term) => text.includes(term));
    const positive = scoreTerms(text, POSITIVE_TERMS);
    const negative = scoreTerms(text, NEGATIVE_TERMS);

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
          ? "Không tìm thấy tín hiệu cảm xúc rõ ràng."
          : `Tín hiệu tích cực: ${positive}; tín hiệu tiêu cực: ${negative}.`,
      language: "vi",
    });
  }
}
