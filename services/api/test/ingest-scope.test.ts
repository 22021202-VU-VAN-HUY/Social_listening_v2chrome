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
const postId = "00000000-0000-4000-8000-000000000010";

function scopeRow() {
  return {
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
  };
}

function batchWithPost(input: {
  sourceId?: string;
  body?: string;
  publishedAt?: string | null;
  timeParseStatus?: "parsed" | "unknown";
}) {
  return contentBatchSchema.parse({
    deviceId: "00000000-0000-4000-8000-000000000020",
    leaseToken: "l".repeat(32),
    fencingToken: 1,
    checksum: "a".repeat(64),
    taskId,
    kind: "content",
    posts: [
      {
        externalId: "post-scope",
        sourceId: input.sourceId ?? sourceId,
        url: "https://www.facebook.com/groups/group/posts/post-scope",
        body: input.body ?? "Tin mới về VSF",
        publishedAt:
          input.publishedAt === undefined
            ? "2026-07-30T10:00:00.000Z"
            : input.publishedAt,
        collectedAt: "2026-07-30T10:01:00.000Z",
        timeParseStatus: input.timeParseStatus ?? "parsed",
        author: {
          authorName: "Tác giả",
          isAnonymous: false,
          authorKind: "real",
        },
        matchedKeywordIds: [keywordId],
      },
    ],
    comments: [],
  });
}

function scopeTransaction(input?: {
  resolvedSourceId?: string;
  previousBody?: string;
}) {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const transaction = {
    async query(sql: string, parameters: unknown[] = []) {
      calls.push({ sql, parameters });
      if (sql.includes("FROM crawl_jobs AS job")) {
        return { rows: [scopeRow()], rowCount: 1 };
      }
      if (sql.includes("FROM keywords AS keyword")) {
        return { rows: [{ id: keywordId }], rowCount: 1 };
      }
      if (sql.includes("FROM sources")) {
        return {
          rows: [{ id: input?.resolvedSourceId ?? sourceId }],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT id, body") && sql.includes("FROM posts")) {
        return input?.previousBody === undefined
          ? { rows: [], rowCount: 0 }
          : {
              rows: [{ id: postId, body: input.previousBody }],
              rowCount: 1,
            };
      }
      if (sql.includes("INSERT INTO posts")) {
        return { rows: [{ id: postId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Transaction;
  return { transaction, calls };
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

test("content ingest rejects an unselected task source before storing a post", async () => {
  const foreignSourceId = "00000000-0000-4000-8000-000000000099";
  const { transaction, calls } = scopeTransaction({
    resolvedSourceId: foreignSourceId,
  });
  await assert.rejects(
    ingestContentBatch(
      transaction,
      workspaceId,
      jobId,
      batchWithPost({ sourceId: foreignSourceId }),
    ),
    (error: unknown) => hasCode(error, "POST_SOURCE_OUT_OF_SCOPE"),
  );
  assert.equal(
    calls.some(({ sql }) => sql.includes("INSERT INTO posts")),
    false,
  );
});

test("content ingest enforces frozen time range and explicit unknown time", async () => {
  const { transaction, calls } = scopeTransaction();
  await assert.rejects(
    ingestContentBatch(
      transaction,
      workspaceId,
      jobId,
      batchWithPost({ publishedAt: "2026-07-01T10:00:00.000Z" }),
    ),
    (error: unknown) => hasCode(error, "POST_TIME_OUT_OF_SCOPE"),
  );
  assert.equal(
    calls.some(({ sql }) => sql.includes("INSERT INTO posts")),
    false,
  );

  const validUnknown = batchWithPost({
    publishedAt: null,
    timeParseStatus: "unknown",
  });
  assert.equal(contentBatchSchema.safeParse(validUnknown).success, true);
  assert.equal(
    contentBatchSchema.safeParse({
      ...validUnknown,
      posts: [
        {
          ...validUnknown.posts[0],
          publishedAt: "2026-07-30T10:00:00.000Z",
        },
      ],
    }).success,
    false,
  );
});

test("comment-only batches require a parent stored by this scoped job", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const transaction = {
    async query(sql: string, parameters: unknown[] = []) {
      calls.push({ sql, parameters });
      if (sql.includes("FROM crawl_jobs AS job")) {
        return { rows: [scopeRow()], rowCount: 1 };
      }
      if (sql.includes("FROM keywords AS keyword")) {
        return { rows: [{ id: keywordId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Transaction;
  const batch = contentBatchSchema.parse({
    deviceId: "00000000-0000-4000-8000-000000000020",
    leaseToken: "l".repeat(32),
    fencingToken: 1,
    checksum: "a".repeat(64),
    taskId,
    kind: "content",
    posts: [],
    comments: [
      {
        externalId: "comment-only",
        postExternalId: "legacy-post",
        body: "Bình luận",
        publishedAt: null,
        collectedAt: "2026-07-30T10:01:00.000Z",
        timeParseStatus: "unknown",
        author: {
          authorName: null,
          isAnonymous: true,
          authorKind: "anonymous",
        },
      },
    ],
  });

  await assert.rejects(
    ingestContentBatch(transaction, workspaceId, jobId, batch),
    (error: unknown) => hasCode(error, "UNKNOWN_COMMENT_POST"),
  );
  const parentSql = calls.find(
    ({ sql }) => sql.includes("SELECT id, body") && sql.includes("FROM posts"),
  )?.sql;
  assert.match(parentSql ?? "", /source_id = \$3/u);
  assert.match(parentSql ?? "", /last_seen_job_id = \$7/u);
  assert.match(parentSql ?? "", /published_at BETWEEN \$5 AND \$6/u);
  assert.match(parentSql ?? "", /hit\.keyword_id = \$4/u);
});

test("changing post context requeues every existing comment for analysis", async () => {
  const { transaction, calls } = scopeTransaction({
    previousBody: "VSF - nội dung cũ",
  });
  await ingestContentBatch(
    transaction,
    workspaceId,
    jobId,
    batchWithPost({ body: "VSF - nội dung mới" }),
  );
  const requeue = calls.find(
    ({ sql }) =>
      sql.includes("INSERT INTO sentiment_queue") &&
      sql.includes("FROM comments AS comment"),
  );
  assert.ok(requeue);
  assert.deepEqual(requeue.parameters.slice(0, 3), [
    workspaceId,
    jobId,
    postId,
  ]);
});
