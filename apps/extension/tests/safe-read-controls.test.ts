import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSafeReadControlElement,
  isSafeReadControlLabel
} from "../src/content/safe-read-controls";
import { FacebookContentRunner } from "../src/content/facebook-runner";
import type { CrawlPostResult, CrawlSearchResult } from "../src/shared/types";
import { isReadOnlyContentCommand } from "../src/shared/types";

afterEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("Facebook read-only control gate", () => {
  it("allows only exact expand/load/search-result controls", () => {
    expect(isSafeReadControlLabel("groups", "Xem thêm")).toBe(true);
    expect(isSafeReadControlLabel("posts", "See more")).toBe(true);
    expect(
      isSafeReadControlLabel("comment_filter_option", "All comments")
    ).toBe(true);
    expect(
      isSafeReadControlLabel("comment_filter_option", "Tất cả bình luận")
    ).toBe(true);
    expect(
      isSafeReadControlLabel("comment_filter_trigger", "Most relevant")
    ).toBe(true);
    expect(
      isSafeReadControlLabel("post_filter_trigger", "Most relevant")
    ).toBe(true);
    expect(
      isSafeReadControlLabel("post_filter_trigger", "Bài viết phù hợp nhất")
    ).toBe(true);
    expect(
      isSafeReadControlLabel("post_filter_option", "Recent posts")
    ).toBe(true);
    expect(
      isSafeReadControlLabel("post_filter_option", "Bài viết mới đây")
    ).toBe(true);
    expect(
      isSafeReadControlLabel("comment_filter_trigger", "Phù hợp nhất")
    ).toBe(true);
    expect(isSafeReadControlLabel("comments", "All comments")).toBe(false);
    expect(isSafeReadControlLabel("comments", "Most relevant")).toBe(false);
    expect(isSafeReadControlLabel("comments", "View more replies")).toBe(true);
    expect(isSafeReadControlLabel("comments", "View 1 more reply")).toBe(true);
    expect(isSafeReadControlLabel("comments", "View 12 more replies")).toBe(true);
    expect(isSafeReadControlLabel("comments", "View 12 replies")).toBe(true);
    expect(isSafeReadControlLabel("comments", "Xem thêm phản hồi")).toBe(true);
    expect(isSafeReadControlLabel("comments", "Xem thêm 12 phản hồi")).toBe(
      true
    );
    expect(isSafeReadControlLabel("comments", "Xem 1 phản hồi")).toBe(true);
    expect(isSafeReadControlLabel("comments", "Xem 12 phản hồi")).toBe(true);
    expect(isSafeReadControlLabel("comments", "View more comments")).toBe(true);
    expect(isSafeReadControlLabel("comments", "View 8 more comments")).toBe(true);
    expect(isSafeReadControlLabel("comments", "Xem thêm 8 bình luận")).toBe(true);
    expect(isSafeReadControlLabel("comments", "See more replies")).toBe(true);
  });

  it.each([
    "Most relevant Like",
    "Most relevant comments",
    "All comments Share",
    "View more replies and reply",
    "View 12 more replies Send",
    "Xem thêm phản hồi và trả lời",
    "Xem thêm 12 phản hồi rồi bình luận",
    "View replies"
  ])("rejects near-match control label %s", (label) => {
    expect(isSafeReadControlLabel("comments", label)).toBe(false);
    expect(isSafeReadControlLabel("comment_filter_trigger", label)).toBe(false);
    expect(isSafeReadControlLabel("comment_filter_option", label)).toBe(false);
    expect(isSafeReadControlLabel("post_filter_trigger", label)).toBe(false);
    expect(isSafeReadControlLabel("post_filter_option", label)).toBe(false);
  });

  it.each([
    "Like",
    "Thích",
    "Comment",
    "Bình luận",
    "Reply",
    "Trả lời",
    "Post",
    "Đăng",
    "Publish",
    "Submit",
    "Send",
    "Gửi",
    "Share",
    "Chia sẻ"
  ])("rejects write interaction label %s", (label) => {
    expect(isSafeReadControlLabel("groups", label)).toBe(false);
    expect(isSafeReadControlLabel("posts", label)).toBe(false);
    expect(isSafeReadControlLabel("comments", label)).toBe(false);
    expect(isSafeReadControlLabel("comment_filter_trigger", label)).toBe(false);
    expect(isSafeReadControlLabel("comment_filter_option", label)).toBe(false);
    expect(isSafeReadControlLabel("post_filter_trigger", label)).toBe(false);
    expect(isSafeReadControlLabel("post_filter_option", label)).toBe(false);
  });

  it("rejects submit and composer elements even with an allowed label", () => {
    document.body.innerHTML = `
      <button id="safe" type="button" aria-label="View more comments"></button>
      <form><button id="submit" type="submit" aria-label="View more comments"></button></form>
      <div data-testid="comment_composer">
        <div id="composer-child" role="button" aria-label="See more"></div>
      </div>
      <div id="write-signature" data-testid="publish_button" role="button" aria-label="See more"></div>
    `;

    expect(
      isSafeReadControlElement("comments", document.querySelector("#safe")!)
    ).toBe(true);
    expect(
      isSafeReadControlElement("comments", document.querySelector("#submit")!)
    ).toBe(false);
    expect(
      isSafeReadControlElement("posts", document.querySelector("#composer-child")!)
    ).toBe(false);
    expect(
      isSafeReadControlElement("posts", document.querySelector("#write-signature")!)
    ).toBe(false);
  });

  it("opens the sort menu once and selects All comments without toggling it closed", async () => {
    document.body.innerHTML = `
      <button id="sort" type="button" aria-label="Most relevant"></button>
      <article data-sl-post>
        <span data-sl-author>Nguyễn An</span>
        <div data-sl-post-body>VSF post</div>
        <a href="https://www.facebook.com/groups/1/posts/2/">Post</a>
        <div data-sl-comment data-sl-comment-id="comment-1">
          <span data-sl-comment-author>Trần Bình</span>
          <div data-sl-comment-body>Comment body</div>
        </div>
        <div role="status">No more comments</div>
      </article>
    `;
    const trigger = document.querySelector<HTMLButtonElement>("#sort");
    if (!trigger) throw new Error("Missing sort trigger.");
    let triggerClicks = 0;
    let optionClicks = 0;
    trigger.addEventListener("click", () => {
      triggerClicks += 1;
      const option = document.createElement("div");
      option.setAttribute("role", "menuitem");
      option.setAttribute("aria-label", "All comments");
      option.addEventListener("click", () => {
        optionClicks += 1;
        trigger.setAttribute("aria-label", "All comments");
        option.remove();
      });
      document.body.append(option);
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    const runner = new FacebookContentRunner(document, window);
    await runner.handle({ type: "ASSIGN_RUN", runId: "filter-run" });
    const result = (await runner.handle({
      type: "CRAWL_POST",
      runId: "filter-run",
      sourceExternalId: "1",
      postExternalId: "2",
      keywords: [{ value: "VSF", matchMode: "whole_word" }],
      windowStartUtc: null,
      windowEndUtc: null,
      limits: {
        maxCommentsPerPost: 10,
        maxCommentExpandRounds: 1,
        mutationWaitMs: 1
      }
    })) as CrawlPostResult;

    expect(triggerClicks).toBe(1);
    expect(optionClicks).toBe(1);
    expect(trigger.getAttribute("aria-label")).toBe("All comments");
    expect(result.comments).toHaveLength(1);
    expect(result.coverageStatus).toBe("complete");
  });

  it("selects Recent posts before extracting Facebook group-search results", async () => {
    document.body.innerHTML = `
      <button id="post-sort" type="button" aria-label="Most relevant" aria-haspopup="menu"></button>
      <article data-sl-post>
        <span data-sl-author>Nguyễn An</span>
        <div data-sl-post-body>VSF post mới</div>
        <a href="https://www.facebook.com/groups/1/posts/post-recent/">Post</a>
      </article>
      <div data-sl-post-search-end="true" data-sl-end-label="End of results"></div>
    `;
    const trigger = document.querySelector<HTMLButtonElement>("#post-sort");
    if (!trigger) throw new Error("Missing post sort trigger.");
    let triggerClicks = 0;
    let optionClicks = 0;
    trigger.addEventListener("click", () => {
      triggerClicks += 1;
      const option = document.createElement("div");
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-label", "Recent posts");
      option.setAttribute("aria-checked", "false");
      option.addEventListener("click", () => {
        optionClicks += 1;
        trigger.setAttribute("aria-label", "Recent posts");
        trigger.setAttribute("aria-expanded", "false");
        option.remove();
      });
      document.body.append(option);
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    const runner = new FacebookContentRunner(document, window);
    await runner.handle({ type: "ASSIGN_RUN", runId: "recent-posts-run" });
    const result = (await runner.handle({
      type: "CRAWL_SEARCH",
      runId: "recent-posts-run",
      sourceExternalId: "1",
      keywords: [{ value: "VSF", matchMode: "whole_word" }],
      windowStartUtc: null,
      windowEndUtc: null,
      limits: {
        maxPostsPerGroup: 10,
        maxScrollRounds: 1,
        mutationWaitMs: 5
      }
    })) as CrawlSearchResult;

    expect(triggerClicks).toBe(1);
    expect(optionClicks).toBe(1);
    expect(trigger.getAttribute("aria-label")).toBe("Recent posts");
    expect(result.posts).toHaveLength(1);
    expect(result.coverageStatus).toBe("complete");
  });

  it("marks post coverage partial when Recent posts cannot be confirmed", async () => {
    document.body.innerHTML = `
      <article data-sl-post>
        <span data-sl-author>Nguyễn An</span>
        <div data-sl-post-body>VSF post mới</div>
        <a href="https://www.facebook.com/groups/1/posts/post-unfiltered/">Post</a>
      </article>
      <div data-sl-post-search-end="true" data-sl-end-label="End of results"></div>
    `;
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    const runner = new FacebookContentRunner(document, window);
    await runner.handle({ type: "ASSIGN_RUN", runId: "missing-filter-run" });
    const result = (await runner.handle({
      type: "CRAWL_SEARCH",
      runId: "missing-filter-run",
      sourceExternalId: "1",
      keywords: [{ value: "VSF", matchMode: "whole_word" }],
      windowStartUtc: null,
      windowEndUtc: null,
      limits: {
        maxPostsPerGroup: 10,
        maxScrollRounds: 1,
        mutationWaitMs: 1
      }
    })) as CrawlSearchResult;

    expect(result.posts).toHaveLength(1);
    expect(result.coverageStatus).toBe("partial");
    expect(result.partialReason).toBe("recent_posts_filter_unconfirmed");
  });

  it("opens newly revealed reply branches before declaring comment coverage", async () => {
    document.body.innerHTML = `
      <article data-sl-post>
        <span data-sl-author>Người đăng bài</span>
        <div data-sl-post-body>VSF post</div>
        <a href="https://www.facebook.com/groups/1/posts/2/">Post</a>
        <div data-sl-comment data-sl-comment-id="comment-root">
          <span data-sl-comment-author>Anh A</span>
          <div data-sl-comment-body>Comment gốc</div>
        </div>
        <button id="expand-reply" type="button">Xem 1 phản hồi</button>
        <button id="expand-comments" type="button">Xem thêm 1 bình luận</button>
      </article>
    `;
    document.querySelector("#expand-reply")?.addEventListener("click", (event) => {
      (event.currentTarget as Element).remove();
      document.querySelector("article")?.insertAdjacentHTML(
        "beforeend",
        `<div data-sl-comment data-sl-comment-id="reply-one" data-parent-comment-id="comment-root">
          <span data-sl-comment-author>Người tham gia ẩn danh</span>
          <div data-sl-comment-body>Anh A cho hỏi thêm</div>
        </div>
        <button id="expand-nested" type="button">Xem 1 phản hồi</button>`
      );
      document.querySelector("#expand-nested")?.addEventListener("click", (nestedEvent) => {
        (nestedEvent.currentTarget as Element).remove();
        document.querySelector("article")?.insertAdjacentHTML(
          "beforeend",
          `<div data-sl-comment data-sl-comment-id="reply-two" data-parent-comment-id="reply-one">
            <span data-sl-comment-author>Anh A</span>
            <div data-sl-comment-body>Trả lời lần hai</div>
          </div>
          <div role="status">No more comments</div>`
        );
      });
    });
    document.querySelector("#expand-comments")?.addEventListener("click", (event) => {
      (event.currentTarget as Element).remove();
      document.querySelector("article")?.insertAdjacentHTML(
        "beforeend",
        `<div data-sl-comment data-sl-comment-id="comment-second">
          <span data-sl-comment-author>Chị B</span>
          <div data-sl-comment-body>Bình luận tiếp theo</div>
        </div>`
      );
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    const runner = new FacebookContentRunner(document, window);
    await runner.handle({ type: "ASSIGN_RUN", runId: "nested-reply-run" });
    const result = (await runner.handle({
      type: "CRAWL_POST",
      runId: "nested-reply-run",
      sourceExternalId: "1",
      postExternalId: "2",
      keywords: [{ value: "VSF", matchMode: "whole_word" }],
      windowStartUtc: null,
      windowEndUtc: null,
      limits: {
        maxCommentsPerPost: 20,
        maxCommentExpandRounds: 6,
        mutationWaitMs: 1
      }
    })) as CrawlPostResult;

    expect(result.comments.map((comment) => comment.externalId)).toEqual([
      "comment-root",
      "reply-one",
      "comment-second",
      "reply-two"
    ]);
    expect(result.comments.find((comment) => comment.externalId === "reply-two"))
      .toMatchObject({ parentCommentExternalId: "reply-one" });
    expect(result.coverageStatus).toBe("complete");
  });

  it("has no write command or Facebook typing/submission/network path", () => {
    for (const writeType of [
      "POST",
      "POST_COMMENT",
      "SUBMIT",
      "SEND",
      "LIKE",
      "REACT",
      "SHARE",
      "TYPE_TEXT"
    ]) {
      expect(isReadOnlyContentCommand({ type: writeType })).toBe(false);
    }
    expect(isReadOnlyContentCommand({ type: "CRAWL_POST" })).toBe(true);

    const contentFiles = [
      "content-script.ts",
      "facebook-runner.ts",
      "facebook-dom-adapter.ts",
      "facebook-urls.ts",
      "safe-read-controls.ts"
    ];
    const contentSource = contentFiles
      .map((name) =>
        readFileSync(
          resolve(import.meta.dirname, "..", "src", "content", name),
          "utf8"
        )
      )
      .join("\n");
    expect(contentSource).not.toMatch(
      /\.submit\s*\(|requestSubmit\s*\(|execCommand\s*\(|insertText|new\s+FormData|XMLHttpRequest|fetch\s*\(/u
    );
    expect(contentSource).not.toMatch(
      /querySelectorAll\s*\([^)]*(?:input|textarea)/u
    );

    const runnerSource = readFileSync(
      resolve(
        import.meta.dirname,
        "..",
        "src",
        "content",
        "facebook-runner.ts"
      ),
      "utf8"
    );
    expect(runnerSource.match(/\.click\(\)/gu)).toHaveLength(1);
    expect(runnerSource).toContain(
      "if (!isSafeReadControlElement(mode, element)) return false;"
    );
  });
});
