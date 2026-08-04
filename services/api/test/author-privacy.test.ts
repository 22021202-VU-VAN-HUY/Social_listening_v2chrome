import assert from "node:assert/strict";
import test from "node:test";
import {
  authorStorageSchema,
  ingestCommentSchema,
  ingestPostSchema,
} from "@listening-social/contracts";
import {
  assertNoIdentityTrackingFields,
  authorForStorage,
  facebookCommentExternalIdFromUrl,
  facebookPostExternalIdFromUrl,
  sanitizeContentUrl,
  sanitizeFacebookContentUrl,
  sanitizeFacebookGroupUrl,
  sanitizeThreadsContentUrl,
  threadsPostExternalIdFromUrl,
} from "../src/privacy.js";

const basePost = {
  externalId: "post-1",
  sourceExternalId: "group-1",
  url: "https://www.facebook.com/groups/group-1/posts/post-1",
  body: "VSF đang làm rất tốt",
  publishedAt: "2026-07-30T01:00:00.000Z",
  collectedAt: "2026-07-30T02:00:00.000Z",
  timeParseStatus: "parsed" as const,
  matchedKeywordIds: [],
};

test("accepts a real display name and stores only the closed privacy shape", () => {
  const parsed = ingestPostSchema.parse({
    ...basePost,
    author: {
      authorName: "Nguyễn Văn An",
      isAnonymous: false,
      authorKind: "real",
    },
  });
  const deliberatelyUntyped = {
    ...parsed.author,
    profileUrl: "https://facebook.com/profile.php?id=123",
    authorId: "123",
  };
  assert.deepEqual(authorForStorage(deliberatelyUntyped), {
    authorName: "Nguyễn Văn An",
    isAnonymous: false,
    authorKind: "real",
    anonymousAvatarVariant: null,
  });
});

test("accepts anonymous content without retaining an alias", () => {
  const parsed = ingestCommentSchema.parse({
    externalId: "comment-1",
    postExternalId: "post-1",
    body: "Một bình luận ẩn danh",
    publishedAt: null,
    collectedAt: "2026-07-30T02:00:00.000Z",
    timeParseStatus: "unknown",
    author: {
      authorName: null,
      isAnonymous: true,
      authorKind: "anonymous",
      anonymousAvatarVariant: 5,
    },
  });
  assert.deepEqual(authorForStorage(parsed.author), {
    authorName: null,
    isAnonymous: true,
    authorKind: "anonymous",
    anonymousAvatarVariant: 5,
  });
});

test("unknown authors always have a null name in contracts and storage", () => {
  const unknown = {
    authorName: null,
    isAnonymous: false,
    authorKind: "unknown",
    anonymousAvatarVariant: null,
  } as const;
  assert.equal(
    ingestCommentSchema.safeParse({
      externalId: "comment-unknown",
      postExternalId: "post-1",
      body: "Không đọc được tác giả",
      publishedAt: null,
      collectedAt: "2026-07-30T02:00:00.000Z",
      timeParseStatus: "unknown",
      author: unknown,
    }).success,
    true,
  );
  assert.equal(
    ingestCommentSchema.safeParse({
      externalId: "comment-unknown-forged-name",
      postExternalId: "post-1",
      body: "Không đọc được tác giả",
      publishedAt: null,
      collectedAt: "2026-07-30T02:00:00.000Z",
      timeParseStatus: "unknown",
      author: { ...unknown, authorName: "Tên không chắc chắn" },
    }).success,
    false,
  );
  assert.equal(
    authorStorageSchema.safeParse({
      author_name: "Tên không chắc chắn",
      is_anonymous: false,
      author_kind: "unknown",
    }).success,
    false,
  );
  assert.deepEqual(authorForStorage(unknown), unknown);
  assert.deepEqual(
    authorForStorage({
      authorName: "Tên từ caller không được tin cậy",
      isAnonymous: false,
      authorKind: "unknown",
    } as never),
    unknown,
  );
});

test("strict author contract rejects IDs, profile links, usernames, and handles", () => {
  for (const forbidden of [
    { authorId: "123" },
    { authorPlatformId: "123" },
    { profileUrl: "https://facebook.com/a" },
    { username: "somebody" },
    { handle: "@somebody" },
  ]) {
    const result = ingestPostSchema.safeParse({
      ...basePost,
      author: {
        authorName: "Some Body",
        isAnonymous: false,
        authorKind: "real",
        ...forbidden,
      },
    });
    assert.equal(result.success, false);
  }
});

test("display-name field rejects a handle or URL masquerading as a name", () => {
  for (const authorName of [
    "@somebody",
    "https://facebook.com/somebody",
    "facebook.com/somebody",
  ]) {
    assert.equal(
      ingestPostSchema.safeParse({
        ...basePost,
        author: { authorName, isAnonymous: false, authorKind: "real" },
      }).success,
      false,
    );
  }
});

test("canonical URLs lose tracking parameters and profile URLs are rejected", () => {
  assert.equal(
    sanitizeContentUrl(
      "https://www.facebook.com/groups/a/posts/b?fbclid=secret&utm_source=x",
    ),
    "https://www.facebook.com/groups/a/posts/b",
  );
  assert.throws(() =>
    sanitizeContentUrl("https://www.facebook.com/profile.php?id=123"),
  );
});

test("Facebook ingest URLs accept only group and group-content entities", () => {
  assert.equal(
    sanitizeFacebookGroupUrl(
      "https://www.facebook.com/groups/vinfuture/?fbclid=secret",
    ),
    "https://www.facebook.com/groups/vinfuture",
  );
  assert.equal(
    sanitizeFacebookContentUrl(
      "https://m.facebook.com/groups/vinfuture/permalink/123?comment_id=456&utm_source=x",
    ),
    "https://m.facebook.com/groups/vinfuture/permalink/123?comment_id=456",
  );
  for (const invalid of [
    "https://example.com/groups/vinfuture/posts/123",
    "https://www.facebook.com/nguyen.van.a?comment_id=456",
    "https://www.facebook.com/profile.php?id=123",
    "https://www.facebook.com/groups/vinfuture",
  ]) {
    assert.throws(() => sanitizeFacebookContentUrl(invalid));
  }
  for (const invalid of [
    "https://example.com/groups/vinfuture",
    "https://www.facebook.com/nguyen.van.a",
    "https://www.facebook.com/groups/vinfuture/posts/123",
  ]) {
    assert.throws(() => sanitizeFacebookGroupUrl(invalid));
  }
});

test("Facebook content URLs provide canonical post and comment identities", () => {
  const replyUrl =
    "https://www.facebook.com/groups/vinfuture/posts/post-123?comment_id=comment-root&reply_comment_id=reply-456";
  assert.equal(facebookPostExternalIdFromUrl(replyUrl), "post-123");
  assert.equal(facebookCommentExternalIdFromUrl(replyUrl), "reply-456");
  assert.equal(
    facebookCommentExternalIdFromUrl(
      "https://www.facebook.com/groups/vinfuture/posts/post-123?comment_id=comment-root",
    ),
    "comment-root",
  );
});

test("Threads URLs discard usernames, query parameters, and unsupported paths", () => {
  assert.equal(
    sanitizeThreadsContentUrl(
      "https://www.threads.com/@huymemez/post/DExample_123?xmt=AQG-secret",
    ),
    "https://www.threads.com/t/DExample_123/",
  );
  assert.equal(
    threadsPostExternalIdFromUrl("https://threads.net/t/DReply_456/"),
    "DReply_456",
  );
  for (const invalid of [
    "https://example.com/@huymemez/post/DExample_123",
    "https://www.threads.com/@huymemez",
    "https://www.threads.com/search?q=VinSmart",
  ]) {
    assert.throws(() => sanitizeThreadsContentUrl(invalid));
  }
});

test("diagnostic metadata rejects identity-tracking keys recursively", () => {
  assert.doesNotThrow(() =>
    assertNoIdentityTrackingFields({ stage: "scrolling", sourceName: "Group A" }),
  );
  assert.throws(() =>
    assertNoIdentityTrackingFields({
      nested: { profileUrl: "https://facebook.com/a" },
    }),
  );
});
