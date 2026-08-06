import {
  SentimentResultSchema,
  type SentimentBatchResult,
  type SentimentInput,
  type SentimentProvider,
  type SentimentResult,
} from "../schema.js";
import { normalizeAnalysisText } from "../hash.js";
import { parseReplyThread } from "../conversation.js";
import { containsTopicReference } from "../topic.js";

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
  "đỉnh",
  "xịn",
  "ổn áp",
  "có tâm",
  "lương tốt",
  "phúc lợi tốt",
  "đãi ngộ tốt",
  "môi trường tốt",
  "đồng nghiệp tốt",
  "quản lý tốt",
  "chuyên nghiệp",
  "work-life balance",
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
  "rác",
  "xạo",
  "tào lao",
  "chán",
  "bê bối",
  "ăn chặn",
  "lương thấp",
  "chậm lương",
  "nợ lương",
  "cắt thưởng",
  "ép overtime",
  "bắt tăng ca",
  "môi trường độc hại",
  "đồng nghiệp toxic",
  "quản lý tệ",
  "sếp tệ",
  "layoff",
  "sa thải",
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

const AGREEMENT_TERMS = [
  "chuẩn",
  "đúng vậy",
  "đúng rồi",
  "đồng ý",
  "chính xác",
  "công nhận",
  "+1",
  "y chang",
];

const DISAGREEMENT_TERMS = [
  "không đúng",
  "đâu có",
  "không phải",
  "sai rồi",
  "sai nhé",
  "không đồng ý",
  "ngược lại",
];

interface StanceScore {
  positive: number;
  negative: number;
  label: "positive" | "negative" | "neutral";
  evidenceCount: number;
}

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

function scoreStance(text: string): StanceScore {
  let positive = scoreTerms(text, POSITIVE_TERMS);
  let negative = scoreTerms(text, NEGATIVE_TERMS);
  positive += scoreTerms(text, NEGATED_NEGATIVE_TERMS) * 2;
  negative += scoreTerms(text, NEGATED_POSITIVE_TERMS) * 2;
  const label =
    positive === negative
      ? "neutral"
      : positive > negative
        ? "positive"
        : "negative";
  return {
    positive,
    negative,
    label,
    evidenceCount: positive + negative,
  };
}

function invertStance(
  label: StanceScore["label"],
): StanceScore["label"] {
  if (label === "positive") return "negative";
  if (label === "negative") return "positive";
  return "neutral";
}

export class HeuristicSentimentProvider implements SentimentProvider {
  readonly name = "heuristic-development";

  constructor(readonly model: string = "vi-lexicon-v1") {}

  async analyze(input: SentimentInput): Promise<SentimentResult> {
    const entityText = normalizeAnalysisText(input.text).toLocaleLowerCase("vi");
    const postContext = normalizeAnalysisText(input.postContext);
    const replyThread = parseReplyThread(input.conversationContext);
    const threadText = replyThread.map((item) => item.text).join(" ");
    const explicitlyTargetsTopic = containsTopicReference(input.text);
    const postTargetsTopic = containsTopicReference(postContext);
    const threadTargetsTopic = containsTopicReference(threadText);
    const contextTargetsTopic = postTargetsTopic || threadTargetsTopic;
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
    const disagreementEvidence = evidenceTerms(
      entityText,
      DISAGREEMENT_TERMS,
    );
    const agreementEvidence = disagreementEvidence.length
      ? []
      : evidenceTerms(entityText, AGREEMENT_TERMS);
    const hasConversationAct =
      agreementEvidence.length + disagreementEvidence.length > 0;
    const isRelevant =
      explicitlyTargetsTopic ||
      (input.entityType === "comment" &&
        contextTargetsTopic &&
        (hasEntityStance || hasConversationAct || postTargetsTopic));

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

    const directStance = scoreStance(entityText);
    let label = directStance.label;
    let inferredFromReply = false;

    if (
      directStance.evidenceCount === 0 &&
      threadTargetsTopic &&
      hasConversationAct
    ) {
      const parentStance = [...replyThread]
        .reverse()
        .map((item) =>
          scoreStance(
            normalizeAnalysisText(item.text).toLocaleLowerCase("vi"),
          ),
        )
        .find((stance) => stance.label !== "neutral");
      if (parentStance) {
        label = disagreementEvidence.length
          ? invertStance(parentStance.label)
          : parentStance.label;
        inferredFromReply = true;
      }
    }

    const confidence =
      inferredFromReply
        ? 0.72
        : label === "neutral"
          ? directStance.evidenceCount === 0
            ? 0.55
            : 0.5
          : Math.min(
              0.95,
              0.65 +
                Math.abs(directStance.positive - directStance.negative) * 0.1,
            );

    return SentimentResultSchema.parse({
      isRelevant,
      label,
      confidence,
      reason:
        inferredFromReply
          ? `Reply ${disagreementEvidence.length ? "phản đối" : "đồng tình với"} một ý trong chuỗi hội thoại về VinSmart Future/VSF.`
          : directStance.evidenceCount === 0
            ? "Nội dung có liên quan theo ngữ cảnh bài viết/hội thoại về VinSmart Future/VSF nhưng không thể hiện thái cực rõ ràng."
            : `Đánh giá VinSmart Future/VSF từ chính nội dung: tín hiệu tích cực ${directStance.positive}, tín hiệu tiêu cực ${directStance.negative}.`,
      language: "vi",
    });
  }

  async analyzeBatch(inputs: SentimentInput[]): Promise<SentimentBatchResult> {
    return Promise.all(
      inputs.map(async (input) => ({
        entityId: input.entityId,
        ...(await this.analyze(input)),
      })),
    );
  }
}
