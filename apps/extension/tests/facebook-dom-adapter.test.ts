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
    const comments = adapter.extractComments({
      postExternalId: "anonymous-post-vi",
      maxComments: 10
    });

    expect(posts).toHaveLength(2);
    expect(comments).toHaveLength(2);
    for (const post of posts) {
      expect(post.author).toEqual({
        authorName: null,
        isAnonymous: true,
        authorKind: "anonymous"
      });
    }
    for (const comment of comments) {
      expect(comment.author).toEqual({
        authorName: null,
        isAnonymous: true,
        authorKind: "anonymous"
      });
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
    const extractedComments = adapter.extractComments({
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
    const comments = adapter.extractComments({
      postExternalId: "post-time-vi",
      maxComments: 10
    });

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
