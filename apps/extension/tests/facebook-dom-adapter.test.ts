import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  FacebookDomAdapter,
  isAnonymousAuthorLabel,
  keywordMatches,
  parseFacebookAbsoluteTimeLabel
} from "../src/content/facebook-dom-adapter";
import {
  canonicalCommentUrl,
  canonicalPostUrl
} from "../src/content/facebook-urls";
import { containsPrivacyForbiddenKey } from "../src/shared/privacy";
import type { CrawlKeyword } from "../src/shared/types";

function fixture(name: string, url: string): JSDOM {
  return new JSDOM(
    readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8"),
    { url }
  );
}

const now = new Date("2026-07-30T03:00:00.000Z");
const keywords: CrawlKeyword[] = [
  { id: "11111111-1111-4111-8111-111111111111", value: "VSF", matchMode: "whole_word" },
  {
    id: "22222222-2222-4222-8222-222222222222",
    value: "Vin Future",
    matchMode: "contains_phrase"
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    value: "Vinfuture",
    matchMode: "contains_phrase"
  }
];

describe("FacebookDomAdapter", () => {
  it("extracts joined groups only and canonicalizes their links", () => {
    const dom = fixture(
      "joined-groups.html",
      "https://www.facebook.com/groups/joins/"
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );

    expect(adapter.extractJoinedGroups()).toEqual([
      {
        externalId: "123456789",
        name: "Cộng đồng VinFuture",
        canonicalUrl: "https://www.facebook.com/groups/123456789/"
      },
      {
        externalId: "vinsmart.future.community",
        name: "VinSmart Future Community",
        canonicalUrl:
          "https://www.facebook.com/groups/vinsmart.future.community/"
      }
    ]);
  });

  it("reads the full joined-groups main list instead of the 10-item navigation", () => {
    const joinedGroups = Array.from(
      { length: 17 },
      (_, index) =>
        `<a href="/groups/joined-${index + 1}/">Nhóm đã tham gia ${index + 1}</a>`
    ).join("");
    const navigationGroups = Array.from(
      { length: 10 },
      (_, index) =>
        `<a href="/groups/navigation-${index + 1}/">Nhóm navigation ${index + 1}</a>`
    ).join("");
    const dom = new JSDOM(
      `
        <nav aria-label="Nhóm">${navigationGroups}</nav>
        <main>
          <h2>Tất cả các nhóm bạn đã tham gia (17)</h2>
          ${joinedGroups}
        </main>
      `,
      { url: "https://www.facebook.com/groups/joins/" }
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );

    expect(adapter.expectedJoinedGroupCount()).toBe(17);
    expect(adapter.extractJoinedGroups(50)).toHaveLength(17);
    expect(
      adapter
        .extractJoinedGroups(50)
        .every((group) => group.externalId.startsWith("joined-"))
    ).toBe(true);
  });

  it("extracts real post, comment and reply without identity links or IDs", () => {
    const dom = fixture(
      "post-real.html",
      "https://www.facebook.com/groups/123456789/posts/987654321/"
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );
    const posts = adapter.extractPosts({
      sourceExternalId: "123456789",
      keywords,
      windowStartUtc: "2026-07-27T00:00:00.000Z",
      windowEndUtc: "2026-07-30T03:00:00.000Z",
      maxPosts: 10
    });
    const comments = adapter.extractComments({
      postExternalId: "987654321",
      maxComments: 10
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.author).toEqual({
      authorName: "Nguyễn Minh An",
      isAnonymous: false,
      authorKind: "real"
    });
    expect(posts[0]?.matchedKeywordIds).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222"
    ]);
    expect(comments).toHaveLength(2);
    expect(comments[0]?.author.authorName).toBe("Trần Bình");
    expect(comments[1]?.parentCommentExternalId).toBe("comment-real-1");
    expect(containsPrivacyForbiddenKey({ posts, comments })).toBe(false);

    const serialized = JSON.stringify({ posts, comments });
    expect(serialized).not.toContain("998877");
    expect(serialized).not.toContain("1000990001");
    expect(serialized).not.toContain("tran.thu.handle");
    expect(serialized).not.toContain("profile.php");
  });

  it("keeps only group post/comment permalinks and drops profile-like links", () => {
    const dom = new JSDOM(
      `
        <article data-sl-post>
          <span data-sl-author>Nguyễn An</span>
          <div data-sl-post-body>VSF valid group post.</div>
          <a href="https://www.facebook.com/groups/1/posts/valid-post/">Post</a>
          <div data-sl-comment data-sl-comment-id="profile-link-comment">
            <a
              data-sl-comment-author
              href="https://www.facebook.com/vanity.profile/?comment_id=profile-token"
            >
              Trần Bình
            </a>
            <div data-sl-comment-body>Profile-like link must not leave.</div>
          </div>
          <div data-sl-comment data-sl-comment-id="external-link-comment">
            <span data-sl-comment-author>Lê Chi</span>
            <div data-sl-comment-body>External link must not leave.</div>
            <a href="https://example.com/groups/1/posts/valid-post/?comment_id=evil">
              External
            </a>
          </div>
        </article>
        <article data-sl-post>
          <span data-sl-author>Vũ Hà</span>
          <div data-sl-post-body>VSF profile post path.</div>
          <a href="https://www.facebook.com/vanity.profile/posts/private-post/">
            Profile post
          </a>
        </article>
      `,
      { url: "https://www.facebook.com/groups/1/" }
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );
    const posts = adapter.extractPosts({
      sourceExternalId: "1",
      keywords,
      windowStartUtc: null,
      windowEndUtc: null,
      maxPosts: 10
    });
    const comments = adapter.extractComments({
      postExternalId: "valid-post",
      maxComments: 10
    });

    expect(posts.map((post) => post.externalId)).toEqual(["valid-post"]);
    expect(comments.map((comment) => comment.url)).toEqual([null, null]);
    expect(JSON.stringify({ posts, comments })).not.toContain("vanity.profile");
    expect(JSON.stringify({ posts, comments })).not.toContain("example.com");
    expect(
      canonicalPostUrl(
        "https://www.facebook.com/vanity.profile/posts/private-post/"
      )
    ).toBeNull();
    expect(
      canonicalCommentUrl(
        "https://www.facebook.com/vanity.profile/?comment_id=profile-token"
      )
    ).toBeNull();
  });

  it("maps Vietnamese and English anonymous labels to null authorName", () => {
    const dom = fixture(
      "post-anonymous.html",
      "https://www.facebook.com/groups/24680/"
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );
    const posts = adapter.extractPosts({
      sourceExternalId: "24680",
      keywords,
      windowStartUtc: "2026-07-27T00:00:00.000Z",
      windowEndUtc: "2026-07-30T03:00:00.000Z",
      maxPosts: 10
    });
    const comments = [
      ...adapter.extractComments({
        postExternalId: "anonymous-post-vi",
        maxComments: 10
      }),
      ...adapter.extractComments({
        postExternalId: "anonymous-post-en",
        maxComments: 10
      })
    ];

    expect(posts).toHaveLength(2);
    expect(comments).toHaveLength(2);
    for (const post of posts) {
      expect(post.author).toMatchObject({
        authorName: null,
        isAnonymous: true,
        authorKind: "anonymous"
      });
      expect(post.author.anonymousAvatarVariant).toBeGreaterThanOrEqual(0);
      expect(post.author.anonymousAvatarVariant).toBeLessThanOrEqual(7);
    }
    for (const comment of comments) {
      expect(comment.author).toMatchObject({
        authorName: null,
        isAnonymous: true,
        authorKind: "anonymous"
      });
      expect(comment.author.anonymousAvatarVariant).toBeGreaterThanOrEqual(0);
      expect(comment.author.anonymousAvatarVariant).toBeLessThanOrEqual(7);
    }
    expect(JSON.stringify({ posts, comments })).not.toContain(
      "Anonymous participant"
    );
    expect(JSON.stringify({ posts, comments })).not.toContain(
      "Thành viên ẩn danh"
    );
  });

  it("detects login, checkpoint and CAPTCHA without attempting bypass", () => {
    const login = new JSDOM("<form action='/login'><input name='email'></form>", {
      url: "https://www.facebook.com/login/"
    });
    const captcha = new JSDOM("<iframe src='/captcha/flow'></iframe>", {
      url: "https://www.facebook.com/checkpoint/"
    });

    expect(
      new FacebookDomAdapter(
        login.window.document,
        login.window.location.href,
        now
      ).detectAuthState().state
    ).toBe("login_required");
    expect(
      new FacebookDomAdapter(
        captcha.window.document,
        captcha.window.location.href,
        now
      ).detectAuthState().state
    ).toBe("challenge_required");
  });

  it("keeps explicit post/comment time status for absolute, relative and unknown labels", () => {
    const dataUtime = Math.floor(
      Date.parse("2026-07-30T00:30:00.000Z") / 1_000
    );
    const dom = new JSDOM(
      `
        <article data-sl-post>
          <span data-sl-author>Nguyễn An</span>
          <div data-sl-post-body>VSF absolute timestamp</div>
          <abbr data-utime="${String(dataUtime)}"></abbr>
          <a href="/groups/1/posts/post-absolute/">Post</a>
        </article>
        <article data-sl-post>
          <span data-sl-author>Trần Bình</span>
          <div data-sl-post-body>VSF relative timestamp</div>
          <span data-sl-relative-time="2 giờ"></span>
          <a href="/groups/1/posts/post-relative/">Post</a>
        </article>
        <article data-sl-post>
          <span data-sl-author>Lê Chi</span>
          <div data-sl-post-body>VSF just now timestamp</div>
          <span data-sl-relative-time="Just now"></span>
          <a href="/groups/1/posts/post-now/">Post</a>
        </article>
        <article data-sl-post>
          <span data-sl-author>Phạm Dũng</span>
          <div data-sl-post-body>VSF unknown timestamp</div>
          <span data-sl-relative-time="Some time"></span>
          <a href="/groups/1/posts/post-unknown/">Post</a>
        </article>
        <article data-sl-post>
          <span data-sl-author>Vũ Hà</span>
          <div data-sl-post-body>VSF invalid absolute timestamp</div>
          <time datetime="2026-02-31T10:30:00.000Z"></time>
          <a href="/groups/1/posts/post-invalid-absolute/">Post</a>
        </article>

        <div data-sl-comment data-sl-comment-id="comment-relative">
          <span data-sl-comment-author>Nguyễn An</span>
          <div data-sl-comment-body>Relative comment</div>
          <span data-sl-relative-time="2 hours"></span>
        </div>
        <div data-sl-comment data-sl-comment-id="comment-now">
          <span data-sl-comment-author>Thành viên ẩn danh</span>
          <div data-sl-comment-body>Just-now comment</div>
          <span data-sl-relative-time="Vừa xong"></span>
        </div>
        <div data-sl-comment data-sl-comment-id="comment-unknown">
          <span data-sl-comment-author>Trần Bình</span>
          <div data-sl-comment-body>Unknown-time comment</div>
          <span data-sl-relative-time="Không rõ"></span>
        </div>
        <div data-sl-comment data-sl-comment-id="comment-contextual-time">
          <span data-sl-comment-author>Lê Chi</span>
          <div data-sl-comment-body>Contextual-time comment</div>
          <span data-sl-relative-time="Edited 2 hours after posting"></span>
        </div>
      `,
      { url: "https://www.facebook.com/groups/1/" }
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );
    const posts = adapter.extractPosts({
      sourceExternalId: "1",
      keywords: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          value: "VSF",
          matchMode: "whole_word"
        }
      ],
      windowStartUtc: null,
      windowEndUtc: null,
      maxPosts: 10
    });
    const commentDom = new JSDOM(
      [...dom.window.document.querySelectorAll("[data-sl-comment]")]
        .map((element) => element.outerHTML)
        .join(""),
      {
        url: "https://www.facebook.com/groups/1/posts/post-absolute/"
      }
    );
    const commentAdapter = new FacebookDomAdapter(
      commentDom.window.document,
      commentDom.window.location.href,
      now
    );
    const extractedComments = commentAdapter.extractComments({
      postExternalId: "post-absolute",
      maxComments: 10
    });

    expect(posts.map((post) => [post.externalId, post.publishedAt, post.timeParseStatus])).toEqual([
      ["post-absolute", "2026-07-30T00:30:00.000Z", "parsed"],
      ["post-relative", "2026-07-30T01:00:00.000Z", "parsed"],
      ["post-now", now.toISOString(), "parsed"],
      ["post-unknown", null, "unknown"],
      ["post-invalid-absolute", null, "unknown"]
    ]);
    expect(
      extractedComments.map((comment) => [
        comment.externalId,
        comment.publishedAt,
        comment.timeParseStatus
      ])
    ).toEqual([
      ["comment-relative", "2026-07-30T01:00:00.000Z", "parsed"],
      ["comment-now", now.toISOString(), "parsed"],
      ["comment-unknown", null, "unknown"],
      ["comment-contextual-time", null, "unknown"]
    ]);
    for (const entity of [...posts, ...extractedComments]) {
      expect(entity.collectedAt).toBe(now.toISOString());
      expect(
        entity.publishedAt !== null || entity.timeParseStatus === "unknown"
      ).toBe(true);
    }

    const recentPosts = adapter.extractPosts({
      sourceExternalId: "1",
      keywords: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          value: "VSF",
          matchMode: "whole_word"
        }
      ],
      windowStartUtc: "2026-07-29T03:00:00.000Z",
      windowEndUtc: now.toISOString(),
      maxPosts: 10
    });
    expect(recentPosts.map((post) => post.externalId)).toEqual([
      "post-absolute",
      "post-relative",
      "post-now"
    ]);
  });

  it("parses only deterministic full Vietnamese and English Facebook aria timestamps", () => {
    const dom = fixture(
      "timestamps-absolute-aria.html",
      "https://www.facebook.com/groups/1/"
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );
    const posts = adapter.extractPosts({
      sourceExternalId: "1",
      keywords: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          value: "VSF",
          matchMode: "whole_word"
        }
      ],
      windowStartUtc: null,
      windowEndUtc: null,
      maxPosts: 10
    });
    const comments = [
      ...adapter.extractComments({
        postExternalId: "post-time-vi",
        maxComments: 10
      }),
      ...adapter.extractComments({
        postExternalId: "post-time-en",
        maxComments: 10
      })
    ];

    expect(
      posts.map((post) => [
        post.externalId,
        post.publishedAt,
        post.timeParseStatus
      ])
    ).toEqual([
      [
        "post-time-vi",
        new Date(2026, 6, 29, 10, 30).toISOString(),
        "parsed"
      ],
      [
        "post-time-en",
        new Date(2026, 6, 30, 8, 15).toISOString(),
        "parsed"
      ],
      ["post-time-unknown", null, "unknown"]
    ]);
    expect(
      comments.map((comment) => [
        comment.externalId,
        comment.publishedAt,
        comment.timeParseStatus
      ])
    ).toEqual([
      [
        "comment-time-en",
        new Date(2026, 6, 29, 11, 45).toISOString(),
        "parsed"
      ],
      [
        "comment-time-vi",
        new Date(2026, 6, 30, 9, 5).toISOString(),
        "parsed"
      ]
    ]);

    expect(
      parseFacebookAbsoluteTimeLabel(
        "Tuesday, July 29, 2026 at 10:30 AM"
      )
    ).toBeNull();
    expect(
      parseFacebookAbsoluteTimeLabel("Wednesday, July 29, 2026 at 10:30")
    ).toBeNull();
    expect(
      parseFacebookAbsoluteTimeLabel("Thứ Tư, 29 tháng 7 lúc 10:30")
    ).toBeNull();
    expect(parseFacebookAbsoluteTimeLabel("07/29/2026 10:30")).toBeNull();
  });

  it("extracts the current Facebook search-card DOM without retaining profile links", () => {
    const dom = new JSDOM(
      `
        <div role="feed">
          <div aria-posinset="5">
            <div data-ad-rendering-role="profile_name">
              Người tham gia ẩn danh
            </div>
            <a aria-labelledby="rendered-post-time" href="?__cft__[0]=redacted">
              scrambled timestamp characters
            </a>
            <div data-ad-rendering-role="story_message">
              <div data-ad-comet-preview="message" data-ad-preview="message">
                VINSMART FUTURE, công ty có chính sách tốt.
              </div>
            </div>
            <div
              role="article"
              aria-label="Bình luận dưới tên Bình vào 2 ngày trước"
            >
              <a role="link" href="https://www.facebook.com/profile.handle">
                <span dir="auto">Bình</span>
              </a>
              <a
                role="link"
                aria-label="Thứ Ba, 28 Tháng 7, 2026 lúc 11:44"
                href="/groups/laptrinhvienit/posts/123456/?comment_id=654321"
              >
                2 ngày
              </a>
              <span lang="vi-VN">
                <div dir="auto">Bình luận thật từ cấu trúc Facebook mới.</div>
              </span>
            </div>
          </div>
        </div>
      `,
      {
        url: "https://www.facebook.com/groups/laptrinhvienit/search/?q=Vinsmart%20Future"
      }
    );
    const renderedTime = dom.window.document.querySelector(
      "[aria-labelledby='rendered-post-time']"
    );
    if (!renderedTime) throw new Error("Expected rendered timestamp fixture.");
    Object.defineProperty(renderedTime, "innerText", {
      configurable: true,
      value: "28 tháng 7 lúc 11:26"
    });

    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );
    const posts = adapter.extractPosts({
      sourceExternalId: "laptrinhvienit",
      keywords: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          value: "Vinsmart Future",
          matchMode: "contains_phrase"
        }
      ],
      windowStartUtc: "2026-07-23T03:00:00.000Z",
      windowEndUtc: now.toISOString(),
      maxPosts: 10
    });
    const comments = adapter.extractComments({
      postExternalId: "123456",
      maxComments: 10
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      externalId: "123456",
      publishedAt: new Date(2026, 6, 28, 11, 26).toISOString(),
      timeParseStatus: "parsed",
      author: {
        authorName: null,
        isAnonymous: true,
        authorKind: "anonymous"
      }
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      externalId: "654321",
      postExternalId: "123456",
      body: "Bình luận thật từ cấu trúc Facebook mới.",
      author: {
        authorName: "Bình",
        isAnonymous: false,
        authorKind: "real"
      }
    });
    expect(JSON.stringify({ posts, comments })).not.toContain("profile.handle");
  });

  it("extracts the background-text permalink DOM from example2 with its keyword", () => {
    const pageUrl =
      "https://www.facebook.com/groups/782850425639223/posts/2100043157253270/";
    const dom = new JSDOM(
      `
        <div data-ad-rendering-role="story_message">
          <div style="background-image: url('facebook-background.jpg')">
            <div aria-hidden="true">
              <div>Anh em bên Vinsmart Future còn thở không vậy</div>
            </div>
            <div>
              <div>Anh em bên Vinsmart Future còn thở không vậy</div>
            </div>
          </div>
        </div>
        <div role="article" aria-label="Bình luận dưới tên Người dùng">
          <span lang="vi">Một bình luận</span>
          <a href="/groups/782850425639223/posts/2100043157253270/?comment_id=2100053100585609">
            8 tuần
          </a>
        </div>
      `,
      { url: pageUrl }
    );
    const keywordId = "44444444-4444-4444-8444-444444444444";
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );

    const posts = adapter.extractPosts({
      sourceExternalId: "782850425639223",
      keywords: [
        {
          id: keywordId,
          value: "Vinsmart Future",
          matchMode: "contains_phrase"
        }
      ],
      windowStartUtc: null,
      windowEndUtc: null,
      maxPosts: 10
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      externalId: "2100043157253270",
      sourceExternalId: "782850425639223",
      url: pageUrl,
      body: "Anh em bên Vinsmart Future còn thở không vậy",
      matchedKeywordIds: [keywordId]
    });
  });

  it("keeps comments scoped to their post and maps sibling replies to the parent", () => {
    const dom = new JSDOM(
      `
        <article data-sl-post>
          <span data-sl-author>Người tham gia ẩn danh</span>
          <div data-sl-post-body>VINSMART FUTURE là bài A.</div>
          <a href="/groups/1/posts/post-a/">Bài A</a>

          <div data-sl-comment>
            <span data-sl-comment-author>Leo</span>
            <div data-sl-comment-body>Bình luận của bài A.</div>
            <a href="/groups/1/posts/post-a/?comment_id=comment-a">
              2 ngày
            </a>
          </div>
          <div data-sl-comment>
            <span data-sl-comment-author>GrayLobster5148</span>
            <div data-sl-comment-body>Leo xin rì viu</div>
            <a
              href="/groups/1/posts/post-a/?comment_id=comment-a&amp;reply_comment_id=reply-a"
            >
              2 ngày
            </a>
          </div>
        </article>

        <article data-sl-post>
          <span data-sl-author>Nguyễn B</span>
          <div data-sl-post-body>VINSMART FUTURE là bài B.</div>
          <a href="/groups/1/posts/post-b/">Bài B</a>
          <div data-sl-comment>
            <span data-sl-comment-author>Người của bài B</span>
            <div data-sl-comment-body>Không được gắn vào bài A.</div>
            <a href="/groups/1/posts/post-b/?comment_id=comment-b">
              1 ngày
            </a>
          </div>
        </article>
      `,
      { url: "https://www.facebook.com/groups/1/search/?q=Vinsmart%20Future" }
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );

    const comments = adapter.extractComments({
      postExternalId: "post-a",
      maxComments: 10
    });

    expect(
      comments.map((comment) => ({
        id: comment.externalId,
        parent: comment.parentCommentExternalId,
        post: comment.postExternalId,
        author: comment.author.authorName,
        body: comment.body
      }))
    ).toEqual([
      {
        id: "comment-a",
        parent: null,
        post: "post-a",
        author: "Leo",
        body: "Bình luận của bài A."
      },
      {
        id: "reply-a",
        parent: "comment-a",
        post: "post-a",
        author: "GrayLobster5148",
        body: "Leo xin rì viu"
      }
    ]);
  });

  it("reads commenter names from aria labels and preserves two reply levels", () => {
    const dom = new JSDOM(
      `
        <article data-sl-post>
          <span data-sl-author>Người đăng bài</span>
          <div data-sl-post-body>VSF cần được review.</div>
          <a href="/groups/1/posts/post-thread/">Bài viết</a>

          <div
            role="article"
            aria-label="Bình luận dưới tên Leo vào 2 ngày trước"
          >
            <span lang="vi">Bình luận cấp gốc</span>
            <a href="/groups/1/posts/post-thread/?comment_id=comment-root">
              2 ngày
            </a>

            <div
              role="article"
              aria-label="Bình luận dưới tên GrayLobster5148 vào 2 ngày trước"
            >
              <span lang="vi">Leo xin rì viu</span>
              <a
                href="/groups/1/posts/post-thread/?comment_id=comment-root&amp;reply_comment_id=reply-level-1"
              >
                2 ngày
              </a>

              <div
                role="article"
                aria-label="Bình luận của Minh Anh vào 1 ngày trước"
              >
                <span lang="vi">Phản hồi tiếp GrayLobster5148</span>
                <a
                  href="/groups/1/posts/post-thread/?comment_id=comment-root&amp;reply_comment_id=reply-level-2"
                >
                  1 ngày
                </a>
              </div>
            </div>
          </div>
        </article>
      `,
      { url: "https://www.facebook.com/groups/1/posts/post-thread/" }
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );

    const comments = adapter.extractComments({
      postExternalId: "post-thread",
      maxComments: 10
    });

    expect(
      comments.map((comment) => ({
        id: comment.externalId,
        parent: comment.parentCommentExternalId,
        author: comment.author.authorName,
        body: comment.body
      }))
    ).toEqual([
      {
        id: "comment-root",
        parent: null,
        author: "Leo",
        body: "Bình luận cấp gốc"
      },
      {
        id: "reply-level-1",
        parent: "comment-root",
        author: "GrayLobster5148",
        body: "Leo xin rì viu"
      },
      {
        id: "reply-level-2",
        parent: "reply-level-1",
        author: "Minh Anh",
        body: "Phản hồi tiếp GrayLobster5148"
      }
    ]);
  });

  it("uses visible reply targets to preserve flattened multi-level threads", () => {
    const dom = new JSDOM(
      `
        <article data-sl-post>
          <span data-sl-author>Người đăng bài</span>
          <div data-sl-post-body>Vinsmart Future đang được thảo luận.</div>
          <a href="/groups/1/posts/post-flat/">Bài viết</a>

          <div data-sl-comment aria-label="Bình luận dưới tên Leo vào 3 giờ trước">
            <span data-sl-comment-body>Bình luận gốc</span>
            <a href="/groups/1/posts/post-flat/?comment_id=comment-root">3 giờ</a>
          </div>
          <div data-sl-comment aria-label="Bình luận dưới tên Gray Lobster vào 2 giờ trước">
            <span data-sl-comment-body>
              <a role="link">Leo</a> Phản hồi bậc một
            </span>
            <a href="/groups/1/posts/post-flat/?comment_id=comment-root&amp;reply_comment_id=reply-one">
              2 giờ
            </a>
          </div>
          <div data-sl-comment aria-label="Bình luận dưới tên Minh Anh vào 1 giờ trước">
            <span data-sl-comment-body>
              <a role="link">Gray Lobster</a> Phản hồi bậc hai
            </span>
            <a href="/groups/1/posts/post-flat/?comment_id=comment-root&amp;reply_comment_id=reply-two">
              1 giờ
            </a>
          </div>
        </article>
      `,
      { url: "https://www.facebook.com/groups/1/posts/post-flat/" }
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );

    const comments = adapter.extractComments({
      postExternalId: "post-flat",
      maxComments: 10
    });

    expect(
      comments.map((comment) => ({
        id: comment.externalId,
        parent: comment.parentCommentExternalId,
        order: comment.observedOrder,
        author: comment.author.authorName
      }))
    ).toEqual([
      {
        id: "comment-root",
        parent: null,
        order: 0,
        author: "Leo"
      },
      {
        id: "reply-one",
        parent: "comment-root",
        order: 1,
        author: "Gray Lobster"
      },
      {
        id: "reply-two",
        parent: "reply-one",
        order: 2,
        author: "Minh Anh"
      }
    ]);
  });

  it("recovers anonymous authors and direct parents from flattened Facebook replies", () => {
    const dom = new JSDOM(
      `
        <article data-sl-post>
          <span data-sl-author>Người đăng bài</span>
          <div data-sl-post-body>VSF có chính sách lương thế nào?</div>
          <a href="/groups/1/posts/post-anonymous-thread/">Bài viết</a>

          <div aria-label="Bình luận dưới tên anh grab zui tính vào 2 ngày trước">
            <div data-sl-comment>
              <span data-sl-comment-body>Deal lương cũ +50%</span>
              <a href="/groups/1/posts/post-anonymous-thread/?comment_id=comment-root">2 ngày</a>
            </div>
          </div>
          <div aria-label="Bình luận dưới tên Người tham gia ẩn danh vào 2 ngày trước">
            <div data-sl-comment>
              <span data-sl-comment-body>anh grab zui tính trừ lương là sao ạ</span>
              <a href="/groups/1/posts/post-anonymous-thread/?comment_id=comment-root&amp;reply_comment_id=reply-anonymous">2 ngày</a>
            </div>
          </div>
          <div aria-label="Bình luận dưới tên Người tham gia ẩn danh 820 vào 2 ngày trước">
            <div data-sl-comment>
              <span data-sl-comment-body>Người tham gia ẩn danh chậm báo cáo là trừ thôi</span>
              <a href="/groups/1/posts/post-anonymous-thread/?comment_id=comment-root&amp;reply_comment_id=reply-nested-anonymous">2 ngày</a>
            </div>
          </div>
          <div aria-label="Bình luận dưới tên anh grab zui tính vào 2 ngày trước">
            <div data-sl-comment>
              <span data-sl-comment-body>Anonymous participant đi trễ 2p cũng bị trừ</span>
              <a href="/groups/1/posts/post-anonymous-thread/?comment_id=comment-root&amp;reply_comment_id=reply-author-followup">2 ngày</a>
            </div>
          </div>
          <div aria-label="Bình luận dưới tên ExcitingLynx6404 vào 2 ngày trước">
            <div data-sl-comment>
              <span data-sl-comment-body>anh grab zui tính sếp deal được +50% không?</span>
              <a href="/groups/1/posts/post-anonymous-thread/?comment_id=comment-root&amp;reply_comment_id=reply-second-branch">2 ngày</a>
            </div>
          </div>
          <div aria-label="Bình luận dưới tên anh grab zui tính vào 2 ngày trước">
            <div data-sl-comment>
              <span data-sl-comment-body>ExcitingLynx6404 được nha</span>
              <a href="/groups/1/posts/post-anonymous-thread/?comment_id=comment-root&amp;reply_comment_id=reply-second-branch-answer">2 ngày</a>
            </div>
          </div>
        </article>
      `,
      {
        url: "https://www.facebook.com/groups/1/posts/post-anonymous-thread/"
      }
    );
    const adapter = new FacebookDomAdapter(
      dom.window.document,
      dom.window.location.href,
      now
    );

    const comments = adapter.extractComments({
      postExternalId: "post-anonymous-thread",
      maxComments: 20
    });

    expect(
      comments.map((comment) => ({
        id: comment.externalId,
        parent: comment.parentCommentExternalId,
        kind: comment.author.authorKind,
        name: comment.author.authorName
      }))
    ).toEqual([
      { id: "comment-root", parent: null, kind: "real", name: "anh grab zui tính" },
      { id: "reply-anonymous", parent: "comment-root", kind: "anonymous", name: null },
      { id: "reply-nested-anonymous", parent: "reply-anonymous", kind: "anonymous", name: null },
      { id: "reply-author-followup", parent: "reply-anonymous", kind: "real", name: "anh grab zui tính" },
      { id: "reply-second-branch", parent: "comment-root", kind: "real", name: "ExcitingLynx6404" },
      { id: "reply-second-branch-answer", parent: "reply-second-branch", kind: "real", name: "anh grab zui tính" }
    ]);
    expect(JSON.stringify(comments)).not.toContain(
      "Người tham gia ẩn danh 820"
    );
    const anonymousComments = comments.filter(
      (comment) => comment.author.authorKind === "anonymous"
    );
    expect(anonymousComments).toHaveLength(2);
    expect(
      anonymousComments.every((comment) =>
        Number.isInteger(comment.author.anonymousAvatarVariant)
      )
    ).toBe(true);
  });
});

describe("keyword and anonymous normalization", () => {
  it("uses whole-word matching for VSF", () => {
    expect(
      keywordMatches("VSF đang phát triển", {
        value: "VSF",
        matchMode: "whole_word"
      })
    ).toBe(true);
    expect(
      keywordMatches("AVSFX không phải keyword", {
        value: "VSF",
        matchMode: "whole_word"
      })
    ).toBe(false);
  });

  it("recognizes Vietnamese and English anonymous labels", () => {
    expect(isAnonymousAuthorLabel("Người tham gia ẩn danh")).toBe(true);
    expect(isAnonymousAuthorLabel("Thành viên ẩn danh")).toBe(true);
    expect(isAnonymousAuthorLabel("Anonymous member")).toBe(true);
    expect(isAnonymousAuthorLabel("Nguyễn Văn A")).toBe(false);
  });
});
