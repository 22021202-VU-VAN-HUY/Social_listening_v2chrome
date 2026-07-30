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
});
