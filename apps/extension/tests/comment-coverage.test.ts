import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { FacebookDomAdapter } from "../src/content/facebook-dom-adapter";
import {
  assessCommentCoverage,
  assessGroupListCoverage,
  assessPostSearchCoverage,
  COMMENT_NO_GROWTH_ROUND_LIMIT,
  FacebookContentRunner,
  type CrawlProgressSignal
} from "../src/content/facebook-runner";
import type { CrawlPostResult } from "../src/shared/types";

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

  it("uses Facebook's displayed total and scrolls the post dialog for more comments", async () => {
    const dom = new JSDOM(
      `<button id="background-reply" type="button">View 9 replies</button>
      <div role="dialog">
        <div id="comment-scroller">
          <article data-sl-post>
            <span data-sl-author>Post author</span>
            <div data-sl-post-body>VSF post</div>
            <a href="https://www.facebook.com/groups/1/posts/2/">Post</a>
            <button type="button" aria-label="Write a comment"><span>2</span></button>
            <div data-sl-comment data-sl-comment-id="comment-1">
              <span data-sl-comment-author>Author one</span>
              <div data-sl-comment-body>First comment</div>
            </div>
          </article>
        </div>
      </div>`,
      { url: "https://www.facebook.com/groups/1/posts/2/" }
    );
    Object.defineProperty(dom.window, "scrollTo", {
      configurable: true,
      value: () => undefined
    });
    let backgroundClicks = 0;
    dom.window.document
      .querySelector("#background-reply")
      ?.addEventListener("click", () => {
        backgroundClicks += 1;
      });
    const scroller = dom.window.document.querySelector<HTMLElement>(
      "#comment-scroller"
    );
    if (!scroller) throw new Error("Missing comment scroller.");
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 100
    });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 500
    });
    scroller.addEventListener(
      "scroll",
      () => {
        dom.window.document.querySelector("article")?.insertAdjacentHTML(
          "beforeend",
          `<div data-sl-comment data-sl-comment-id="comment-2">
            <span data-sl-comment-author>Author two</span>
            <div data-sl-comment-body>Second comment</div>
          </div>`
        );
      },
      { once: true }
    );

    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href
    );
    expect(adapter.expectedCommentCount("2")).toBe(2);

    const runner = new FacebookContentRunner(
      dom.window.document,
      dom.window as unknown as Window
    );
    await runner.handle({ type: "ASSIGN_RUN", runId: "dialog-scroll-run" });
    const result = (await runner.handle({
      type: "CRAWL_POST",
      runId: "dialog-scroll-run",
      sourceExternalId: "1",
      postExternalId: "2",
      keywords: [{ value: "VSF", matchMode: "whole_word" }],
      windowStartUtc: null,
      windowEndUtc: null,
      limits: {
        maxCommentsPerPost: 20,
        maxCommentExpandRounds: 4,
        mutationWaitMs: 1
      }
    })) as CrawlPostResult;

    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(backgroundClicks).toBe(0);
    expect(result.comments.map((comment) => comment.externalId)).toEqual([
      "comment-1",
      "comment-2"
    ]);
    expect(result.coverageStatus).toBe("complete");
  });

  it("reports liveness and leaves an unproductive comment control behind", async () => {
    const dom = new JSDOM(
      `<article data-sl-post>
        <div data-sl-post-body>VSF post</div>
        <a href="https://www.facebook.com/groups/1/posts/2/">Post</a>
        <button type="button">View more comments</button>
      </article>`,
      { url: "https://www.facebook.com/groups/1/posts/2/" }
    );
    Object.defineProperty(dom.window, "scrollTo", {
      configurable: true,
      value: () => undefined
    });
    const progress: CrawlProgressSignal[] = [];
    const runner = new FacebookContentRunner(
      dom.window.document,
      dom.window as unknown as Window,
      (signal) => {
        progress.push(signal);
      }
    );
    await runner.handle({ type: "ASSIGN_RUN", runId: "run-stale-control" });
    const result = (await runner.handle({
      type: "CRAWL_POST",
      runId: "run-stale-control",
      sourceExternalId: "1",
      postExternalId: "2",
      keywords: [{ value: "VSF", matchMode: "whole_word" }],
      windowStartUtc: null,
      windowEndUtc: null,
      limits: {
        maxCommentsPerPost: 20,
        maxCommentExpandRounds: 40,
        mutationWaitMs: 1
      }
    })) as CrawlPostResult;

    const crawlRounds = progress
      .filter((signal) => signal.operation === "crawl_post")
      .map((signal) => signal.round);
    expect(crawlRounds).toContain(1);
    expect(crawlRounds.filter((round) => round > 0).length).toBeGreaterThan(1);
    expect(Math.max(...crawlRounds)).toBeLessThanOrEqual(
      COMMENT_NO_GROWTH_ROUND_LIMIT
    );
    expect(result.coverageStatus).toBe("unknown");
    expect(result.partialReason).toBe("comment_end_not_proven");
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
