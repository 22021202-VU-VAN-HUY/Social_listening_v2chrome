import assert from "node:assert/strict";
import test from "node:test";
import { contentBatchSchema } from "@listening-social/contracts";
import type { Transaction } from "../src/db.js";
import { ingestContentBatch } from "../src/ingest.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const keywordId = "00000000-0000-4000-8000-000000000004";
const taskId = "00000000-0000-4000-8000-000000000005";

test("new posts and comments stay pending until manual AI analysis", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  let commentSequence = 0;
  const transaction = {
    async query(sql: string, parameters: unknown[] = []) {
      calls.push({ sql, parameters });
      if (sql.includes("FROM crawl_jobs AS job")) {
        return {
          rows: [
            {
              settings_snapshot: {
                sourceIds: [sourceId],
                keywords: [
                  {
                    id: keywordId,
                    value: "VSF",
                    matchMode: "whole_word",
                  },
                ],
                windowStartUtc: "2026-07-29T00:00:00.000Z",
                windowEndUtc: "2026-07-31T00:00:00.000Z",
              },
              task_source_id: sourceId,
              task_keyword_id: keywordId,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM keywords AS keyword")) {
        return {
          rows: [{ id: keywordId }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM sources")) {
        return { rows: [{ id: sourceId }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO posts")) {
        return {
          rows: [{ id: "00000000-0000-4000-8000-000000000010" }],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT id, content_hash") && sql.includes("FROM comments")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO comments")) {
        commentSequence += 1;
        return {
          rows: [
            {
              id:
                commentSequence === 1
                  ? "00000000-0000-4000-8000-000000000011"
                  : "00000000-0000-4000-8000-000000000012",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Transaction;

  const timestamp = "2026-07-30T10:00:00.000Z";
  const batch = contentBatchSchema.parse({
    deviceId: "00000000-0000-4000-8000-000000000020",
    leaseToken: "l".repeat(32),
    fencingToken: 1,
    checksum: "a".repeat(64),
    taskId,
    kind: "content",
    posts: [
      {
        externalId: "post-context-1",
        sourceId,
        url: "https://www.facebook.com/groups/group/posts/post-context-1",
        body: "VSF là ngữ cảnh bài post",
        publishedAt: timestamp,
        collectedAt: timestamp,
        timeParseStatus: "parsed",
        author: {
          authorName: "Tác giả bài viết",
          isAnonymous: false,
          authorKind: "real",
        },
        matchedKeywordIds: [keywordId],
      },
    ],
    comments: [
      {
        externalId: "comment-real",
        postExternalId: "post-context-1",
        body: "Bình luận từ người dùng thật",
        publishedAt: timestamp,
        collectedAt: timestamp,
        timeParseStatus: "parsed",
        author: {
          authorName: "Nguyễn An",
          isAnonymous: false,
          authorKind: "real",
        },
      },
      {
        externalId: "comment-anonymous",
        postExternalId: "post-context-1",
        body: "Bình luận ẩn danh",
        publishedAt: timestamp,
        collectedAt: timestamp,
        timeParseStatus: "parsed",
        author: {
          authorName: null,
          isAnonymous: true,
          authorKind: "anonymous",
        },
      },
    ],
  });

  const accepted = await ingestContentBatch(
    transaction,
    workspaceId,
    jobId,
    batch,
  );

  assert.deepEqual(accepted, { sources: 0, posts: 1, comments: 2 });
  assert.equal(calls.filter(({ sql }) => sql.includes("INSERT INTO posts")).length, 1);
  assert.equal(
    calls.filter(({ sql }) => sql.includes("INSERT INTO keyword_hits")).length,
    1,
  );

  const queueCalls = calls.filter(({ sql }) =>
    sql.includes("INSERT INTO sentiment_queue"),
  );
  assert.equal(queueCalls.length, 0, "crawl must not spend AI tokens automatically");

  const commentCalls = calls.filter(({ sql }) =>
    sql.includes("INSERT INTO comments"),
  );
  assert.deepEqual(commentCalls[0]?.parameters.slice(10, 13), [
    "Nguyễn An",
    false,
    "real",
  ]);
  assert.deepEqual(commentCalls[1]?.parameters.slice(10, 13), [
    null,
    true,
    "anonymous",
  ]);
});
