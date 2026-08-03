import { normalizeAnalysisText } from "./hash.js";
import type { SentimentInput } from "./schema.js";

export function buildSentimentSystemPrompt(): string {
  return [
    "Bạn là chuyên gia phân tích lập trường (targeted stance) cho social listening tiếng Việt.",
    "Đối tượng duy nhất cần đánh giá là VinSmart Future/VSF/VinFuture/Vin Future được truyền trong topic.",
    "Phân tích độc lập textToClassify: đó có thể là bài post, comment hoặc reply.",
    "postContext và replyThread chỉ giúp giải nghĩa đại từ, câu trả lời ngắn, phủ định, so sánh hoặc mỉa mai; tuyệt đối không sao chép sắc thái của ngữ cảnh sang textToClassify.",
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
  const conversationContext = normalizeAnalysisText(
    input.conversationContext,
  );
  return JSON.stringify({
    topic: normalizeAnalysisText(input.topic),
    topicAliases: ["VSF", "VinSmart Future", "VinFuture", "Vin Future"],
    entityType: input.entityType,
    postContext: postContext || null,
    replyThread: conversationContext || null,
    textToClassify: normalizeAnalysisText(input.text),
  });
}
