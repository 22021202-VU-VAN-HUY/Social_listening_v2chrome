import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HeuristicSentimentProvider } from "../src/sentiment/providers/heuristic.js";

describe("HeuristicSentimentProvider", () => {
  const provider = new HeuristicSentimentProvider();

  it("labels a positive relevant comment using its parent-post context", async () => {
    const result = await provider.analyze({
      entityType: "comment",
      entityId: "comment-positive-1",
      text: "Chương trình rất tốt và ấn tượng",
      postContext: "Bài viết mới nhất về VinFuture",
      topic: "VinFuture",
    });

    assert.equal(result.isRelevant, true);
    assert.equal(result.label, "positive");
  });

  it("uses parent post context for a short comment", async () => {
    const result = await provider.analyze({
      entityType: "comment",
      entityId: "comment-1",
      text: "Thật thất vọng",
      postContext: "Thông tin mới nhất về VSF",
      topic: "VinFuture",
    });

    assert.equal(result.isRelevant, true);
    assert.equal(result.label, "negative");
  });

  it("uses post context for relevance without inheriting its positive label", async () => {
    const result = await provider.analyze({
      entityType: "comment",
      entityId: "comment-neutral-1",
      text: "Thông tin được đăng lúc mấy giờ?",
      postContext: "VSF tổ chức chương trình tuyệt vời và rất ý nghĩa",
      topic: "Vinsmart Future",
    });

    assert.equal(result.isRelevant, true);
    assert.equal(result.label, "neutral");
  });

  it("understands a negated positive phrase aimed at VSF", async () => {
    const result = await provider.analyze({
      entityType: "comment",
      entityId: "comment-negative-2",
      text: "VSF lần này không tốt và thiếu minh bạch",
      postContext: "Thông báo mới từ VSF",
      topic: "Vinsmart Future",
    });

    assert.equal(result.isRelevant, true);
    assert.equal(result.label, "negative");
  });

  it("uses the reply thread only to resolve the target", async () => {
    const result = await provider.analyze({
      entityType: "comment",
      entityId: "reply-positive-1",
      text: "Không tệ, mình ủng hộ",
      postContext: "Bài post thảo luận giải thưởng VSF",
      conversationContext: "Bạn nghĩ thế nào về hoạt động của VSF?",
      topic: "Vinsmart Future",
    });

    assert.equal(result.isRelevant, true);
    assert.equal(result.label, "positive");
  });

  it("recognizes a Vietnamese phonetic spelling of VSF", async () => {
    const result = await provider.analyze({
      entityType: "comment",
      entityId: "comment-phonetic-vsf",
      text: "Vờ sờ phờ lần này làm quá tệ",
      topic: "VinSmart Future",
    });

    assert.equal(result.isRelevant, true);
    assert.equal(result.label, "negative");
  });

  it("recognizes separated VSF initials", async () => {
    const result = await provider.analyze({
      entityType: "post",
      entityId: "post-separated-vsf",
      text: "V.S.F có chương trình rất ý nghĩa",
      topic: "VinSmart Future",
    });

    assert.equal(result.isRelevant, true);
    assert.equal(result.label, "positive");
  });

  it("inherits the target and stance only when a reply explicitly agrees", async () => {
    const result = await provider.analyze({
      entityType: "comment",
      entityId: "reply-agrees-negative",
      text: "Chuẩn luôn",
      postContext: "Bài thảo luận về VSF",
      conversationContext: JSON.stringify([
        { level: 1, text: "VSF làm chương trình này quá tệ" },
      ]),
      topic: "VinSmart Future",
    });

    assert.equal(result.isRelevant, true);
    assert.equal(result.label, "negative");
  });

  it("inverts a parent stance when a reply explicitly disagrees", async () => {
    const result = await provider.analyze({
      entityType: "comment",
      entityId: "reply-disagrees-negative",
      text: "Không đúng đâu",
      postContext: "Bài thảo luận về VSF",
      conversationContext: JSON.stringify([
        { level: 1, text: "VSF làm chương trình này quá tệ" },
      ]),
      topic: "VinSmart Future",
    });

    assert.equal(result.isRelevant, true);
    assert.equal(result.label, "positive");
  });

  it("does not treat a generic Future mention as VinSmart Future", async () => {
    const result = await provider.analyze({
      entityType: "post",
      entityId: "post-unrelated-future",
      text: "Future of work đang thay đổi rất nhanh",
      topic: "VinSmart Future",
    });

    assert.equal(result.isRelevant, false);
    assert.equal(result.label, "neutral");
  });

  it("covers workplace experience about VinSmart Future", async () => {
    const result = await provider.analyze({
      entityType: "comment",
      entityId: "comment-workplace",
      text: "Lương thấp, quản lý tệ và thường xuyên bắt tăng ca",
      postContext: "Mọi người review môi trường công sở tại VSF giúp mình",
      topic: "VinSmart Future",
    });

    assert.equal(result.isRelevant, true);
    assert.equal(result.label, "negative");
  });
});
