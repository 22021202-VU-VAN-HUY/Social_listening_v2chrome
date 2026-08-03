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

  it("does not inherit a positive label from the post context", async () => {
    const result = await provider.analyze({
      entityType: "comment",
      entityId: "comment-neutral-1",
      text: "Thông tin được đăng lúc mấy giờ?",
      postContext: "VSF tổ chức chương trình tuyệt vời và rất ý nghĩa",
      topic: "Vinsmart Future",
    });

    assert.equal(result.isRelevant, false);
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
});
