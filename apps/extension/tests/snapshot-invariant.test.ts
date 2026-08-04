import { describe, expect, it } from "vitest";
import {
  assertCommentListeningSnapshot,
  normalizeJobSnapshot
} from "../src/backend/snapshot";

function crawlSnapshot(crawlComments: boolean) {
  return normalizeJobSnapshot({
    kind: "crawl_content",
    sources: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        externalId: "facebook-group-1",
        name: "Group",
        canonicalUrl: "https://www.facebook.com/groups/facebook-group-1/"
      }
    ],
    keywords: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        value: "VSF",
        matchMode: "whole_word"
      }
    ],
    tasks: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        sourceId: "11111111-1111-4111-8111-111111111111",
        keywordId: "22222222-2222-4222-8222-222222222222",
        state: "pending"
      }
    ],
    crawlComments
  });
}

describe("comment-only crawl invariant", () => {
  it("preserves durable task state and checkpoint from a reclaimed job", () => {
    const snapshot = normalizeJobSnapshot({
      ...crawlSnapshot(true),
      tasks: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          sourceId: "11111111-1111-4111-8111-111111111111",
          keywordId: "22222222-2222-4222-8222-222222222222",
          state: "running",
          checkpoint: {
            phase: "comments_uploaded",
            sourceIndex: 0,
            keywordIndex: 0,
            postIndex: 9
          }
        }
      ]
    });

    expect(snapshot.tasks[0]).toMatchObject({
      state: "running",
      checkpoint: {
        phase: "comments_uploaded",
        sourceIndex: 0,
        keywordIndex: 0,
        postIndex: 9
      }
    });
  });

  it("accepts crawl jobs that collect comments", () => {
    expect(() =>
      assertCommentListeningSnapshot(crawlSnapshot(true))
    ).not.toThrow();
  });

  it("rejects post-only crawl jobs at runtime", () => {
    expect(() =>
      assertCommentListeningSnapshot(crawlSnapshot(false))
    ).toThrow(/crawlComments=true/u);
  });

  it("does not reject group discovery jobs", () => {
    const discovery = normalizeJobSnapshot({
      kind: "discover_groups",
      tasks: []
    });
    expect(() => assertCommentListeningSnapshot(discovery)).not.toThrow();
  });

  it("rejects a crawl snapshot without its required source-keyword task", () => {
    const snapshot = crawlSnapshot(true);
    snapshot.tasks = [];
    expect(() => assertCommentListeningSnapshot(snapshot)).toThrow(
      /missing a task/u
    );
  });

  it("accepts only exact Facebook group roots as crawl sources", () => {
    const snapshot = normalizeJobSnapshot({
      kind: "crawl_content",
      sources: [
        {
          externalId: "valid",
          url: "https://web.facebook.com/groups/valid/?ref=share"
        },
        {
          externalId: "group-post",
          url: "https://www.facebook.com/groups/valid/posts/123/"
        },
        {
          externalId: "profile",
          url: "https://www.facebook.com/some.profile/"
        },
        {
          externalId: "external",
          url: "https://example.com/groups/valid/"
        }
      ]
    });

    expect(snapshot.sources).toEqual([
      {
        externalId: "valid",
        name: "valid",
        url: "https://www.facebook.com/groups/valid/"
      }
    ]);
  });
});
