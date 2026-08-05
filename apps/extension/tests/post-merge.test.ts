import { describe, expect, it } from "vitest";
import {
  claimPostForCommentCrawl,
  excludePreviouslySeenPosts,
  mergePostKeywordHits
} from "../src/shared/post-merge";
import type { SafePostDto } from "../src/shared/types";

function post(keywordId: string): SafePostDto {
  return {
    externalId: "facebook-post-1",
    sourceExternalId: "facebook-group-1",
    url: "https://www.facebook.com/groups/facebook-group-1/posts/facebook-post-1/",
    body: "VSF và Vin Future cùng xuất hiện.",
    publishedAt: "2026-07-30T01:00:00.000Z",
    collectedAt: "2026-07-30T03:00:00.000Z",
    timeParseStatus: "parsed",
    matchedKeywordIds: [keywordId],
    author: {
      authorName: "Nguyễn An",
      isAnonymous: false,
      authorKind: "real"
    }
  };
}

describe("mergePostKeywordHits", () => {
  it("preserves every keyword hit while keeping one parent post", () => {
    const first = post("11111111-1111-4111-8111-111111111111");
    const second = post("22222222-2222-4222-8222-222222222222");
    const merged = mergePostKeywordHits(first, second);

    expect(merged.hasNewKeywordHit).toBe(true);
    expect(merged.post.externalId).toBe(first.externalId);
    expect(merged.post.matchedKeywordIds).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222"
    ]);
  });

  it("does not flag a duplicate keyword for another comment crawl", () => {
    const first = post("11111111-1111-4111-8111-111111111111");
    const duplicate = post("11111111-1111-4111-8111-111111111111");
    expect(mergePostKeywordHits(first, duplicate).hasNewKeywordHit).toBe(false);
  });

  it("claims the same Facebook post for comment crawling only once per run", () => {
    const crawled = new Set<string>();
    expect(claimPostForCommentCrawl(crawled, "facebook-post-1")).toBe(true);
    expect(claimPostForCommentCrawl(crawled, "facebook-post-1")).toBe(false);
    expect(claimPostForCommentCrawl(crawled, "facebook-post-2")).toBe(true);
  });

  it("removes posts whose canonical link was seen in an earlier job", () => {
    const first = post("11111111-1111-4111-8111-111111111111");
    const second = {
      ...post("22222222-2222-4222-8222-222222222222"),
      externalId: "facebook-post-2",
      url: "https://www.facebook.com/groups/facebook-group-1/posts/facebook-post-2/"
    };
    const result = excludePreviouslySeenPosts(
      [first, second],
      new Set([first.url])
    );

    expect(result.skipped).toBe(1);
    expect(result.posts.map((item) => item.externalId)).toEqual([
      "facebook-post-2"
    ]);
  });
});
