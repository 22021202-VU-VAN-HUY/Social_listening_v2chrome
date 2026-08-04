import assert from "node:assert/strict";
import test from "node:test";
import {
  completeJobSchema,
  createCrawlJobSchema,
  extensionHeartbeatSchema,
  jobSnapshotSchema,
  platformSettingsSchema,
  postViewSchema,
} from "@listening-social/contracts";

test("crawl jobs allow the official Threads connector but not an unimplemented platform", () => {
  assert.equal(
    createCrawlJobSchema.safeParse({ platform: "threads", lookbackPreset: "7_days" }).success,
    true,
  );
  assert.equal(createCrawlJobSchema.safeParse({ platform: "tiktok" }).success, false);
});

test("settings contracts are strict and enforce server hard limits", () => {
  const valid = {
    platform: "facebook",
    lookbackPreset: "7_days",
    crawlComments: true,
    maxSourcesPerJob: 50,
    maxPostsPerSource: 300,
    maxCommentsPerPost: 500,
    maxRuntimeMinutes: 120,
    enabled: true,
  };
  assert.equal(platformSettingsSchema.safeParse(valid).success, true);
  assert.equal(
    platformSettingsSchema.safeParse({ ...valid, maxSourcesPerJob: 51 }).success,
    false,
  );
  assert.equal(
    platformSettingsSchema.safeParse({ ...valid, unexpected: true }).success,
    false,
  );
  assert.equal(
    platformSettingsSchema.safeParse({ ...valid, crawlComments: false }).success,
    false,
    "comment-only listening must never accept a post-only crawl setting",
  );
  assert.equal(
    platformSettingsSchema.safeParse({ ...valid, maxCommentsPerPost: 0 }).success,
    false,
    "comment-only listening must collect at least one comment per matching post",
  );
});

test("heartbeat requires a complete lease proof tuple", () => {
  assert.equal(
    extensionHeartbeatSchema.safeParse({
      deviceId: "00000000-0000-4000-8000-000000000010",
      extensionVersion: "0.1.0",
      status: "running",
      jobId: "00000000-0000-4000-8000-000000000011",
    }).success,
    false,
  );
});

test("crawl snapshots cannot disable or zero-out comment collection", () => {
  const snapshot = {
    sourceIds: ["00000000-0000-4000-8000-000000000001"],
    keywordIds: ["00000000-0000-4000-8000-000000000002"],
    keywords: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        value: "VinFuture",
        normalizedValue: "vinfuture",
        matchMode: "contains_phrase",
      },
    ],
    windowStartUtc: "2026-07-29T00:00:00.000Z",
    windowEndUtc: "2026-07-30T00:00:00.000Z",
    timezone: "Asia/Ho_Chi_Minh",
    lookbackPreset: "3_days",
    crawlComments: true,
    limits: {
      maxSourcesPerJob: 50,
      maxPostsPerSource: 300,
      maxCommentsPerPost: 500,
      maxRuntimeMinutes: 120,
    },
    adapterVersion: "facebook-dom-v1",
  };

  assert.equal(jobSnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(
    jobSnapshotSchema.safeParse({ ...snapshot, crawlComments: false }).success,
    false,
  );
  assert.equal(
    jobSnapshotSchema.safeParse({
      ...snapshot,
      limits: { ...snapshot.limits, maxCommentsPerPost: 0 },
    }).success,
    false,
  );
});

test("post views expose pending or completed sentiment", () => {
  const post = {
    id: "00000000-0000-4000-8000-000000000001",
    platform: "facebook",
    externalId: "post-context-1",
    sourceId: "00000000-0000-4000-8000-000000000002",
    sourceName: "Nhóm khoa học",
    url: "https://www.facebook.com/groups/science/posts/post-context-1",
    body: "VinFuture",
    publishedAt: "2026-07-30T00:00:00.000Z",
    collectedAt: "2026-07-30T00:01:00.000Z",
    timeParseStatus: "parsed",
    author: {
      authorName: "Nguyễn An",
      isAnonymous: false,
      authorKind: "real",
    },
    matchedKeywords: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        value: "VinFuture",
        matchMode: "contains_phrase",
      },
    ],
    sentiment: null,
  };

  assert.equal(postViewSchema.safeParse(post).success, true);
  assert.equal(
    postViewSchema.safeParse({
      ...post,
      sentiment: {
        label: "positive",
        confidence: 0.9,
        isRelevant: true,
        needsReview: false,
      },
    }).success,
    true,
  );
});

test("partial completion requires a reason", () => {
  assert.equal(
    completeJobSchema.safeParse({
      deviceId: "00000000-0000-4000-8000-000000000010",
      leaseToken: "a".repeat(32),
      fencingToken: 1,
      outcome: "partial",
    }).success,
    false,
  );
});
