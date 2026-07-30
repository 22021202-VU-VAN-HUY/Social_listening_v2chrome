import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAnalysisInputHash } from "../src/sentiment/hash.js";

describe("createAnalysisInputHash", () => {
  it("changes when a comment has different post context", () => {
    const first = createAnalysisInputHash({
      entityType: "comment",
      entityId: "comment-1",
      text: "Rất tốt",
      postContext: "VSF vừa công bố chương trình mới",
      topic: "VinFuture",
    });
    const second = createAnalysisInputHash({
      entityType: "comment",
      entityId: "comment-2",
      text: "Rất tốt",
      postContext: "Đây không phải nội dung về VinFuture",
      topic: "VinFuture",
    });

    assert.notEqual(first, second);
  });

  it("normalizes equivalent whitespace and unicode input", () => {
    const first = createAnalysisInputHash({
      entityType: "comment",
      entityId: "comment-1",
      text: "VinFuture   rất tốt",
      postContext: "Bài viết về VinFuture",
      topic: "VinFuture",
    });
    const second = createAnalysisInputHash({
      entityType: "comment",
      entityId: "comment-2",
      text: "VinFuture rất tốt",
      postContext: "Bài viết về VinFuture",
      topic: "VinFuture",
    });

    assert.equal(first, second);
  });
});
