import assert from "node:assert/strict";
import test from "node:test";
import {
  parseConversationSegment,
  parseReplyThread,
} from "../src/sentiment/conversation.js";

test("reply context is normalized from root ancestor to direct parent", () => {
  const thread = parseReplyThread(
    JSON.stringify([
      { level: 1, text: "Câu cha trực tiếp" },
      { level: 3, text: "Câu gốc" },
      { level: 2, text: "Câu ở giữa" },
    ]),
  );

  assert.deepEqual(
    thread.map(({ depth, relation, text }) => ({ depth, relation, text })),
    [
      { depth: 3, relation: "ancestor", text: "Câu gốc" },
      { depth: 2, relation: "ancestor", text: "Câu ở giữa" },
      { depth: 1, relation: "direct_parent", text: "Câu cha trực tiếp" },
    ],
  );
});

test("a structured segment keeps the target and replies below it", () => {
  const segment = parseConversationSegment(
    JSON.stringify({
      version: 2,
      mode: "comment_with_replies",
      targetCommentId: "comment-target",
      truncated: false,
      items: [
        {
          entityId: "comment-root",
          parentEntityId: null,
          level: 1,
          relation: "ancestor",
          text: "VSF là công ty đang được nhắc tới",
        },
        {
          entityId: "comment-target",
          parentEntityId: "comment-root",
          level: 0,
          relation: "target",
          text: "Môi trường công sở thế nào?",
        },
        {
          entityId: "comment-reply",
          parentEntityId: "comment-target",
          level: 1,
          relation: "reply",
          text: "Đồng nghiệp tốt nhưng quản lý chưa ổn",
        },
      ],
    }),
  );

  assert.equal(segment.mode, "comment_with_replies");
  assert.equal(segment.targetCommentId, "comment-target");
  assert.deepEqual(
    segment.items.map(({ relation, text }) => ({ relation, text })),
    [
      { relation: "ancestor", text: "VSF là công ty đang được nhắc tới" },
      { relation: "target", text: "Môi trường công sở thế nào?" },
      { relation: "reply", text: "Đồng nghiệp tốt nhưng quản lý chưa ổn" },
    ],
  );
  assert.equal(parseReplyThread(JSON.stringify({
    mode: "comment_with_replies",
    targetCommentId: "comment-target",
    items: segment.items,
  }))[0]?.relation, "direct_parent");
});
