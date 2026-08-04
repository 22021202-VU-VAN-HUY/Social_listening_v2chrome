import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ThreadsDomAdapter } from "../src/content/threads-dom-adapter";

function card(input: {
  username: string;
  shortcode: string;
  body: string;
  publishedAt: string;
}): string {
  return `
    <div data-pressable-container="true">
      <a href="/@${input.username}"><span dir="auto">${input.username}</span></a>
      <a href="/@${input.username}/post/${input.shortcode}">
        <time datetime="${input.publishedAt}">1 giờ</time>
      </a>
      <span dir="auto">${input.body}</span>
      <button aria-label="Thích 2"><span dir="auto">2</span></button>
    </div>
  `;
}

describe("ThreadsDomAdapter", () => {
  it("extracts locally matching search results without retaining usernames", () => {
    const dom = new JSDOM(`
      <nav><a href="/messages/">Tin nhắn</a></nav>
      ${card({
        username: "person.one",
        shortcode: "MATCH_123",
        body: "Tôi muốn review VinSmart Future",
        publishedAt: "2026-08-04T04:00:00.000Z"
      })}
      ${card({
        username: "other.person",
        shortcode: "NO_MATCH",
        body: "Nội dung không liên quan",
        publishedAt: "2026-08-04T04:10:00.000Z"
      })}
    `);
    const adapter = new ThreadsDomAdapter(
      dom.window.document,
      "https://www.threads.com/search?q=VinSmart%20Future"
    );
    const posts = adapter.extractPosts({
      sourceExternalId: "threads:web-search",
      keywords: [
        {
          id: "00000000-0000-4000-8000-000000000100",
          value: "VinSmart Future",
          matchMode: "contains_phrase"
        }
      ],
      windowStartUtc: "2026-08-04T00:00:00.000Z",
      windowEndUtc: "2026-08-04T23:59:59.999Z",
      maxPosts: 10
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      externalId: "MATCH_123",
      url: "https://www.threads.com/t/MATCH_123/",
      body: "Tôi muốn review VinSmart Future",
      author: { authorName: null, authorKind: "unknown" }
    });
    expect(JSON.stringify(posts)).not.toContain("person.one");
  });

  it("treats non-root cards on a detail page as replies", () => {
    const dom = new JSDOM(`
      ${card({
        username: "root.user",
        shortcode: "ROOT_1",
        body: "VinSmart Future đang tuyển dụng",
        publishedAt: "2026-08-04T04:00:00.000Z"
      })}
      ${card({
        username: "reply.user",
        shortcode: "REPLY_1",
        body: "Môi trường làm việc thế nào?",
        publishedAt: "2026-08-04T05:00:00.000Z"
      })}
    `);
    const adapter = new ThreadsDomAdapter(
      dom.window.document,
      "https://www.threads.com/@root.user/post/ROOT_1"
    );
    const comments = adapter.extractComments({
      postExternalId: "ROOT_1",
      maxComments: 10
    });

    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      externalId: "REPLY_1",
      postExternalId: "ROOT_1",
      parentCommentExternalId: null,
      url: "https://www.threads.com/t/REPLY_1/"
    });
    expect(JSON.stringify(comments)).not.toContain("reply.user");
  });
});
