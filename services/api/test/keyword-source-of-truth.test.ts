import assert from "node:assert/strict";
import test from "node:test";
import { contentBatchSchema } from "@listening-social/contracts";
import type { Transaction } from "../src/db.js";
import { ingestContentBatch } from "../src/ingest.js";
import { keywordMatches, normalizeKeyword } from "../src/keywords.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const actualWholeWordId = "00000000-0000-4000-8000-000000000004";
const falseClaimId = "00000000-0000-4000-8000-000000000005";
const actualPhraseId = "00000000-0000-4000-8000-000000000006";
const taskId = "00000000-0000-4000-8000-000000000007";
const forgedForeignId = "00000000-0000-4000-8000-000000000099";
const postId = "00000000-0000-4000-8000-000000000010";

function postBatch(body: string, matchedKeywordIds: string[]) {
  const timestamp = "2026-07-30T10:00:00.000Z";
  return contentBatchSchema.parse({
    deviceId: "00000000-0000-4000-8000-000000000020",
    leaseToken: "l".repeat(32),
    fencingToken: 1,
    checksum: "a".repeat(64),
    taskId,
    kind: "content",
    posts: [
      {
        externalId: "post-keyword-trust",
        sourceId,
        url: "https://www.facebook.com/groups/group/posts/post-keyword-trust",
        body,
        publishedAt: timestamp,
        collectedAt: timestamp,
        timeParseStatus: "parsed",
        author: {
          authorName: "Tác giả",
          isAnonymous: false,
          authorKind: "real",
        },
        matchedKeywordIds,
      },
    ],
    comments: [],
  });
}

test("Unicode keyword matching honors whole-word and phrase modes", () => {
  assert.equal(normalizeKeyword("  ＶＳＦ  "), "vsf");
  assert.equal(
    keywordMatches("Thông tin về ＶＳＦ hôm nay", {
      value: "vsf",
      matchMode: "whole_word",
    }),
    true,
  );
  assert.equal(
    keywordMatches("VSFuture không phải token VSF", {
      value: "VSF",
      matchMode: "whole_word",
    }),
    true,
  );
  assert.equal(
    keywordMatches("VSFuture", {
      value: "VSF",
      matchMode: "whole_word",
    }),
    false,
  );
  assert.equal(
    keywordMatches("VIN \n  FUTURE", {
      value: "Vin Future",
      matchMode: "contains_phrase",
    }),
    true,
  );
});

test("ingest ignores forged claims, derives every real hit, and removes stale hits", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const storedHits = new Set<string>();
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
                    id: actualWholeWordId,
                    value: "VSF",
                    matchMode: "whole_word",
                  },
                  {
                    id: falseClaimId,
                    value: "Vinfuture",
                    matchMode: "contains_phrase",
                  },
                  {
                    id: actualPhraseId,
                    value: "Vin Future",
                    matchMode: "contains_phrase",
                  },
                ],
                windowStartUtc: "2026-07-29T00:00:00.000Z",
                windowEndUtc: "2026-07-31T00:00:00.000Z",
              },
              task_source_id: sourceId,
              task_keyword_id: actualPhraseId,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM keywords AS keyword")) {
        return {
          rows: [
            { id: actualWholeWordId },
            { id: falseClaimId },
            { id: actualPhraseId },
          ],
          rowCount: 3,
        };
      }
      if (sql.includes("FROM sources")) {
        return { rows: [{ id: sourceId }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO posts")) {
        return { rows: [{ id: postId }], rowCount: 1 };
      }
      if (sql.includes("DELETE FROM keyword_hits")) {
        storedHits.clear();
        return { rows: [], rowCount: 2 };
      }
      if (sql.includes("INSERT INTO keyword_hits")) {
        storedHits.add(parameters[0] as string);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Transaction;

  await ingestContentBatch(
    transaction,
    workspaceId,
    jobId,
    postBatch("Tin mới về VSF và VIN FUTURE", [
      forgedForeignId,
      falseClaimId,
    ]),
  );

  assert.deepEqual([...storedHits].sort(), [
    actualWholeWordId,
    actualPhraseId,
  ]);
  const insertsAfterFirstBatch = calls.filter(({ sql }) =>
    sql.includes("INSERT INTO keyword_hits"),
  );
  assert.deepEqual(
    insertsAfterFirstBatch.map(({ parameters }) => parameters[0]).sort(),
    [actualWholeWordId, actualPhraseId],
  );
  assert.deepEqual(
    insertsAfterFirstBatch.map(({ parameters }) => parameters.slice(2, 4)),
    [
      ["VSF", "whole_word"],
      ["Vin Future", "contains_phrase"],
    ],
    "hit metadata must use the immutable values and modes from the job snapshot",
  );
  assert.equal(
    insertsAfterFirstBatch.some(({ parameters }) =>
      [forgedForeignId, falseClaimId].includes(parameters[0] as string),
    ),
    false,
  );

  await ingestContentBatch(
    transaction,
    workspaceId,
    jobId,
    postBatch("Bài viết đã được sửa và chỉ còn Vin Future", [
      forgedForeignId,
      actualWholeWordId,
      actualPhraseId,
    ]),
  );

  assert.deepEqual([...storedHits], [actualPhraseId]);
  assert.equal(
    calls.filter(({ sql }) => sql.includes("DELETE FROM keyword_hits")).length,
    2,
  );
  assert.equal(
    calls.filter(({ sql }) => sql.includes("INSERT INTO keyword_hits")).length,
    3,
    "false or stale extension claims must never create a server-side hit",
  );

  const trustedJobQuery = calls.find(({ sql }) =>
    sql.includes("FROM crawl_jobs AS job"),
  )?.sql;
  assert.match(trustedJobQuery ?? "", /job\.settings_snapshot/u);
  assert.match(trustedJobQuery ?? "", /job\.type = 'crawl_content'/u);
  assert.match(trustedJobQuery ?? "", /task\.id = \$3/u);

  await assert.rejects(
    ingestContentBatch(
      transaction,
      workspaceId,
      jobId,
      postBatch("Bài viết hoàn toàn ngoài chủ đề", [
        forgedForeignId,
        actualWholeWordId,
      ]),
    ),
    (error: unknown) =>
      objectHasCode(error, "POST_KEYWORD_MISMATCH"),
  );
  assert.deepEqual([...storedHits], [actualPhraseId]);
});

function objectHasCode(value: unknown, code: string): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "code" in value &&
    (value as { code?: unknown }).code === code
  );
}
