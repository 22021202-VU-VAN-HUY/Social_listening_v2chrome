import assert from "node:assert/strict";
import test from "node:test";
import { ThreadsClient } from "../src/threads/client.js";

test("Threads client uses RECENT keyword search, a frozen window, and bearer auth", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let authorization = "";
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "media-1",
            text: "VinSmart Future",
            timestamp: "2026-08-04T01:00:00+0000",
            permalink: "https://www.threads.net/@private-handle/post/ABC123",
            shortcode: "ABC123",
            is_reply: false,
          },
        ],
        paging: { cursors: { after: "cursor-2" } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const client = new ThreadsClient({
      baseUrl: "https://graph.threads.net/",
      apiVersion: "v1.0",
      accessToken: "secret-token",
    });
    const page = await client.searchKeyword({
      query: "VinSmart Future",
      since: new Date("2026-08-01T00:00:00Z"),
      until: new Date("2026-08-04T00:00:00Z"),
      limit: 100,
      afterCursor: null,
    });
    const url = new URL(requestUrl);
    assert.equal(url.pathname, "/v1.0/keyword_search");
    assert.equal(url.searchParams.get("search_type"), "RECENT");
    assert.equal(url.searchParams.get("search_mode"), "KEYWORD");
    assert.equal(url.searchParams.get("q"), "VinSmart Future");
    assert.equal(
      url.searchParams.get("fields"),
      "id,text,timestamp,permalink,is_reply",
    );
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(authorization, "Bearer secret-token");
    assert.equal(page.afterCursor, "cursor-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
