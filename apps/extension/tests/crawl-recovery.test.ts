import { describe, expect, it } from "vitest";
import {
  checkpointForClaim,
  CRAWL_STALL_TIMEOUT_MS,
  isCrawlStalled
} from "../src/background/crawl-recovery";
import type { JobSnapshot } from "../src/shared/types";

function snapshot(): JobSnapshot {
  return {
    kind: "crawl_content",
    sources: [
      {
        id: "source-1",
        externalId: "group-1",
        name: "Group 1",
        url: "https://www.facebook.com/groups/group-1/"
      }
    ],
    keywords: [
      { id: "keyword-1", value: "VSF", matchMode: "whole_word" },
      { id: "keyword-2", value: "VinFast", matchMode: "whole_word" }
    ],
    tasks: [
      {
        id: "task-1",
        sourceId: "source-1",
        keywordId: "keyword-1",
        state: "completed"
      },
      {
        id: "task-2",
        sourceId: "source-1",
        keywordId: "keyword-2",
        state: "pending",
        checkpoint: {
          phase: "comments_uploaded",
          sourceIndex: 0,
          keywordIndex: 1,
          postIndex: 17
        }
      }
    ],
    windowStartUtc: null,
    windowEndUtc: null,
    crawlComments: true,
    limits: {
      maxGroups: 50,
      maxScrollRounds: 30,
      maxPostsPerGroup: 300,
      maxCommentsPerPost: 500,
      maxCommentExpandRounds: 40,
      mutationWaitMs: 1_200
    }
  };
}

describe("crawl recovery", () => {
  it("fires only after a full minute without observable progress", () => {
    const startedAt = 1_000_000;
    expect(
      isCrawlStalled(startedAt, startedAt + CRAWL_STALL_TIMEOUT_MS - 1)
    ).toBe(false);
    expect(
      isCrawlStalled(startedAt, startedAt + CRAWL_STALL_TIMEOUT_MS)
    ).toBe(true);
  });

  it("resumes the first unfinished task at its durable post checkpoint", () => {
    expect(checkpointForClaim(snapshot())).toEqual({
      phase: "comments_uploaded",
      sourceIndex: 0,
      keywordIndex: 1,
      postIndex: 17
    });
  });

  it("does not trust a checkpoint that belongs to another task position", () => {
    const value = snapshot();
    value.tasks[1]!.checkpoint = {
      phase: "comments_uploaded",
      sourceIndex: 0,
      keywordIndex: 0,
      postIndex: 17
    };
    expect(checkpointForClaim(value)).toEqual({
      phase: "start",
      sourceIndex: 0,
      keywordIndex: 1,
      postIndex: 0
    });
  });

  it("returns done when every crawl task was completed", () => {
    const value = snapshot();
    value.tasks[1]!.state = "completed";
    expect(checkpointForClaim(value)).toEqual({
      phase: "done",
      sourceIndex: 1,
      keywordIndex: 0,
      postIndex: 0
    });
  });
});
