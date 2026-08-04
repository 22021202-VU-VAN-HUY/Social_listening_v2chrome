import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { FacebookDomAdapter } from "../src/content/facebook-dom-adapter";
import {
  assessCommentCoverage,
  assessGroupListCoverage,
  assessPostSearchCoverage,
  FacebookContentRunner,
  type CrawlProgressSignal
} from "../src/content/facebook-runner";

describe("comment coverage assessment", () => {
  it("emits a progress pulse when a background crawl command starts", async () => {
    const dom = new JSDOM("<main></main>", {
      url: "https://www.facebook.com/groups/joins/"
    });
    const progress: CrawlProgressSignal[] = [];
    const runner = new FacebookContentRunner(
      dom.window.document,
      dom.window as unknown as Window,
      (signal) => {
        progress.push(signal);
      }
    );
    await runner.handle({ type: "ASSIGN_RUN", runId: "run-progress-test" });
    await runner.handle({
      type: "DISCOVER_GROUPS",
      runId: "run-progress-test",
      limits: { maxGroups: 50, maxScrollRounds: 0, mutationWaitMs: 1 }
    });

    expect(progress).toEqual([
      {
        type: "CRAWL_PROGRESS",
        runId: "run-progress-test",
        operation: "discover_groups",
        round: 0,
        itemsSeen: 0
      }
    ]);
  });

  it("keeps a hard comment limit partial even when an end marker is visible", () => {
    expect(assessCommentCoverage(true, true)).toEqual({
      coverageStatus: "partial",
      partialReason: "comment_limit_reached"
    });
  });

  it("reports unknown when the end of comments cannot be proven", () => {
    expect(assessCommentCoverage(false, false)).toEqual({
      coverageStatus: "unknown",
      partialReason: "comment_end_not_proven"
    });
  });

  it("does not turn group or post-search plateaus into silent completeness", () => {
    expect(assessGroupListCoverage(false, false)).toEqual({
      coverageStatus: "unknown",
      partialReason: "group_list_end_not_proven"
    });
    expect(assessPostSearchCoverage(false, false)).toEqual({
      coverageStatus: "unknown",
      partialReason: "post_search_end_not_proven"
    });
    expect(assessGroupListCoverage(true, true)).toEqual({
      coverageStatus: "partial",
      partialReason: "group_limit_reached"
    });
    expect(assessPostSearchCoverage(true, true)).toEqual({
      coverageStatus: "partial",
      partialReason: "post_limit_reached"
    });

    const groupEnd = new JSDOM(
      "<div role='status'>Bạn đã xem hết danh sách</div>",
      { url: "https://www.facebook.com/groups/joins/" }
    );
    const searchEnd = new JSDOM("<div role='status'>No results</div>", {
      url: "https://www.facebook.com/groups/1/search/"
    });
    expect(
      new FacebookDomAdapter(
        groupEnd.window.document,
        groupEnd.window.location.href
      ).hasExplicitGroupListEnd()
    ).toBe(true);
    expect(
      new FacebookDomAdapter(
        searchEnd.window.document,
        searchEnd.window.location.href
      ).hasExplicitPostSearchEnd()
    ).toBe(true);
  });

  it("reports complete only for an exact explicit end marker", () => {
    const exact = new JSDOM(
      "<div role='status'>Không còn bình luận nào</div>",
      { url: "https://www.facebook.com/groups/1/posts/2/" }
    );
    const nearMatch = new JSDOM(
      "<div role='status'>Không còn bình luận nào được ghim</div>",
      { url: "https://www.facebook.com/groups/1/posts/2/" }
    );

    const exactAdapter = new FacebookDomAdapter(
      exact.window.document,
      exact.window.location.href
    );
    const nearMatchAdapter = new FacebookDomAdapter(
      nearMatch.window.document,
      nearMatch.window.location.href
    );

    expect(exactAdapter.hasExplicitCommentEnd()).toBe(true);
    expect(assessCommentCoverage(false, exactAdapter.hasExplicitCommentEnd())).toEqual({
      coverageStatus: "complete"
    });
    expect(nearMatchAdapter.hasExplicitCommentEnd()).toBe(false);
  });
});
