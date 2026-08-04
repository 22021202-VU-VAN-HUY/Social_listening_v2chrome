import assert from "node:assert/strict";
import test from "node:test";
import { mapThreadsRootPost } from "../src/threads/mapper.js";
import { keywordMatches } from "../src/threads/matcher.js";
import { canonicalThreadsPostUrl } from "../src/threads/url-policy.js";

const windowStart = new Date("2026-08-01T00:00:00Z");
const windowEnd = new Date("2026-08-05T00:00:00Z");

test("mapper accepts a matching root post and removes the handle from its URL", () => {
  const mapped = mapThreadsRootPost(
    {
      id: "media-1",
      text: "Tin mới về  VinSmart   Future hôm nay",
      timestamp: "2026-08-04T01:00:00+0000",
      permalink: "https://www.threads.net/@private-handle/post/ABC_123",
      is_reply: false,
    },
    {
      keyword: "VinSmart Future",
      matchMode: "contains_phrase",
      windowStart,
      windowEnd,
    },
  );
  assert.ok(mapped);
  assert.equal(mapped.canonicalUrl, "https://www.threads.com/t/ABC_123/");
  assert.equal(JSON.stringify(mapped).includes("private-handle"), false);
});

test("mapper rejects replies, out-of-window candidates, and local false positives", () => {
  const base = {
    id: "media-1",
    text: "VinSmart Future",
    timestamp: "2026-08-04T01:00:00+0000",
    permalink: "https://www.threads.net/@user/post/ABC123",
    is_reply: false,
  };
  const input = {
    keyword: "VinSmart Future",
    matchMode: "contains_phrase" as const,
    windowStart,
    windowEnd,
  };
  assert.equal(mapThreadsRootPost({ ...base, is_reply: true }, input), null);
  assert.equal(
    mapThreadsRootPost({ ...base, timestamp: "2026-07-01T00:00:00Z" }, input),
    null,
  );
  assert.equal(mapThreadsRootPost({ ...base, text: "Unrelated" }, input), null);
});

test("whole-word matcher does not match VSF inside a longer token", () => {
  assert.equal(keywordMatches("VSF có tin mới", { value: "VSF", matchMode: "whole_word" }), true);
  assert.equal(keywordMatches("AVSF2", { value: "VSF", matchMode: "whole_word" }), false);
});

test("URL policy rejects non-Threads hosts", () => {
  assert.equal(
    canonicalThreadsPostUrl(undefined, "https://evil.example/@user/post/ABC123"),
    null,
  );
});
