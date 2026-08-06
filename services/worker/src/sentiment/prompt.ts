import { normalizeAnalysisText } from "./hash.js";
import type { SentimentInput } from "./schema.js";
import { parseConversationSegment } from "./conversation.js";
import {
  TOPIC_ALIASES,
  TOPIC_VARIANT_EXAMPLES,
  findTopicReferences,
} from "./topic.js";

export function buildSentimentSystemPrompt(): string {
  return [
    "Bạn là chuyên gia phân tích lập trường (targeted stance) cho social listening tiếng Việt.",
    "Đối tượng duy nhất cần đánh giá là VinSmart Future/VSF/VinFuture/Vin Future được truyền trong topic.",
    "Phân tích độc lập textToClassify: đó có thể là bài post, comment hoặc reply.",
    "Phạm vi VinSmart Future bao gồm thương hiệu/tổ chức, hoạt động, sản phẩm/dịch vụ và trải nghiệm công sở như tuyển dụng, lương thưởng, chính sách, quản lý, đồng nghiệp, văn hóa hoặc môi trường làm việc.",
    "Nhận diện cả viết tắt, tách ký tự, bỏ dấu câu, cách đọc tên chữ cái và cách viết theo âm tiếng Việt nếu chúng hợp lý trong ngữ cảnh, ví dụ V.S.F, V S F, vi ét ép, vờ sờ phờ, Vin Smat Future hoặc Vin Sờ Mát Phiu Chờ.",
    "Không coi riêng các từ chung như 'Vin', 'Future', 'VF' hoặc một cách viết gần giống là đối tượng nếu ngữ cảnh không đủ xác nhận; không được nhầm sang một tổ chức/chủ đề khác.",
    "postContext cung cấp chủ đề chung; conversationSegment chứa comment tổ tiên, target và các reply bên dưới theo đúng thứ tự hội thoại để đánh giá target trong toàn cảnh.",
    "Trong conversationSegment, relation=target chính là textToClassify; relation=ancestor là chuỗi cha và relation=reply là phản hồi bên dưới. Dùng toàn đoạn để hiểu người/vấn đề đang được nói tới, đại từ, tiếng lóng, nói lái, phủ định và mỉa mai.",
    "Với reply ngắn, hãy xác định nó đang đồng ý, phản đối, phủ định, trả lời hay mỉa mai direct_parent nào; có thể kế thừa đối tượng đang được nói tới nhưng tuyệt đối không sao chép sắc thái của ngữ cảnh nếu reply không thể hiện sự tiếp nối.",
    "Ví dụ: parent khen VSF, reply 'chuẩn' là positive; reply 'không đúng đâu' là negative. Parent chê VSF, reply 'chuẩn' là negative; reply bác bỏ lời chê có thể là positive.",
    "isRelevant=true khi textToClassify trực tiếp nói về đối tượng hoặc rõ ràng đang phản hồi một ý về đối tượng trong ngữ cảnh hội thoại.",
    "isRelevant=false khi nội dung nói về người/chủ đề khác hoặc không đủ căn cứ gắn thái độ với đối tượng; trường hợp này label phải là neutral.",
    "positive chỉ dùng khi nội dung thể hiện khen ngợi, tin tưởng, ủng hộ, hài lòng hoặc kỳ vọng tích cực đối với đối tượng.",
    "negative chỉ dùng khi nội dung thể hiện chê bai, phản đối, thất vọng, nghi ngờ, cáo buộc hoặc bất mãn đối với đối tượng.",
    "neutral dùng cho thông tin mô tả, câu hỏi không thể hiện thái độ, nội dung cân bằng/mâu thuẫn, mơ hồ hoặc không liên quan.",
    "Xử lý cẩn thận từ phủ định như 'không tệ', 'không tốt', cấu trúc 'nhưng/tuy nhiên', slang, emoji và mỉa mai.",
    "Không gán positive/negative chỉ vì postContext có từ cảm xúc.",
    "Không suy luận danh tính người viết.",
    "Trả JSON duy nhất với isRelevant, label, confidence, reason, language.",
    "reason phải nêu ngắn gọn bằng chứng trong textToClassify và mối liên hệ với đối tượng; không bịa thêm ngữ cảnh.",
    "label bắt buộc là positive, negative hoặc neutral.",
  ].join(" ");
}

export function buildSentimentUserPrompt(input: SentimentInput): string {
  const postContext = normalizeAnalysisText(input.postContext);
  const conversationSegment = parseConversationSegment(
    input.conversationContext,
  );
  const conversationText = conversationSegment.items
    .map((item) => item.text)
    .join(" ");
  return JSON.stringify({
    topic: normalizeAnalysisText(input.topic),
    topicAliases: TOPIC_ALIASES,
    topicVariantExamples: TOPIC_VARIANT_EXAMPLES,
    topicReferenceHints: {
      textToClassify: findTopicReferences(input.text),
      postContext: findTopicReferences(postContext),
      conversationSegment: findTopicReferences(conversationText),
    },
    entityType: input.entityType,
    postContext: postContext || null,
    conversationSegment: conversationSegment.items.length
      ? {
          order: "ancestors_target_replies",
          targetCommentId: conversationSegment.targetCommentId,
          truncated: conversationSegment.truncated,
          items: conversationSegment.items,
        }
      : null,
    textToClassify: normalizeAnalysisText(input.text),
  });
}

export function buildSentimentBatchSystemPrompt(): string {
  return [
    buildSentimentSystemPrompt(),
    "Đây là yêu cầu batch cho một đoạn hội thoại. Đánh giá riêng từng target nhưng đọc toàn bộ conversationSegment một lần để giữ đúng ngữ cảnh giữa comment và reply.",
    "Trả JSON duy nhất dạng {results:[{entityId,isRelevant,label,confidence,reason,language}]}; phải có đúng một kết quả cho mỗi entityId được yêu cầu, không thêm hoặc bỏ mục.",
  ].join(" ");
}

export function buildSentimentBatchUserPrompt(
  inputs: SentimentInput[],
): string {
  if (inputs.length === 0) {
    throw new Error("A sentiment batch cannot be empty.");
  }
  const segments = inputs.map((input) =>
    parseConversationSegment(input.conversationContext),
  );
  const conversationSegment = segments.reduce(
    (largest, candidate) =>
      candidate.items.length > largest.items.length ? candidate : largest,
    segments[0]!,
  );
  const postContext = normalizeAnalysisText(inputs[0]!.postContext);
  const conversationText = conversationSegment.items
    .map((item) => item.text)
    .join(" ");

  return JSON.stringify({
    topic: normalizeAnalysisText(inputs[0]!.topic),
    topicAliases: TOPIC_ALIASES,
    topicVariantExamples: TOPIC_VARIANT_EXAMPLES,
    topicReferenceHints: {
      postContext: findTopicReferences(postContext),
      conversationSegment: findTopicReferences(conversationText),
    },
    postContext: postContext || null,
    conversationSegment: conversationSegment.items.length
      ? {
          order: "ancestors_target_replies",
          truncated: conversationSegment.truncated,
          items: conversationSegment.items,
        }
      : null,
    targets: inputs.map((input) => ({
      entityId: input.entityId,
      entityType: input.entityType,
      textToClassify: normalizeAnalysisText(input.text),
    })),
  });
}
