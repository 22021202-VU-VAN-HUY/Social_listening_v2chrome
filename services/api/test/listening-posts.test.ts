import assert from "node:assert/strict";
import test from "node:test";
import { postViewSchema } from "@listening-social/contracts";
import Fastify from "fastify";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db.js";
import { registerListeningRoutes } from "../src/routes/listening.js";

test("post route returns all matched keyword metadata and never sentiment", async () => {
  let querySql = "";
  const database = {
    async query(sql: string) {
      querySql = sql;
      return {
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000010",
            platform: "facebook",
            external_id: "post-1",
            source_id: "00000000-0000-4000-8000-000000000002",
            source_name: "Nhóm khoa học",
            canonical_url:
              "https://www.facebook.com/groups/science/posts/post-1",
            body: "VSF và Vin Future",
            published_at: new Date("2026-07-30T00:00:00.000Z"),
            collected_at: new Date("2026-07-30T00:01:00.000Z"),
            time_parse_status: "parsed",
            author_name: "Tên legacy không đáng tin",
            is_anonymous: false,
            author_kind: "unknown",
            matched_keywords: [
              {
                id: "00000000-0000-4000-8000-000000000004",
                value: "VSF",
                matchMode: "whole_word",
              },
              {
                id: "00000000-0000-4000-8000-000000000006",
                value: "Vin Future",
                matchMode: "contains_phrase",
              },
            ],
            sentiment_label: "positive",
            sentiment_confidence: "0.99",
            sentiment_relevant: true,
            sentiment_needs_review: false,
          },
        ],
        rowCount: 1,
      };
    },
  } as unknown as Database;
  const app = Fastify({ logger: false });
  registerListeningRoutes(app, {
    config: loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    database,
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/listening/posts?includeUnknownTime=true",
  });
  await app.close();

  assert.equal(response.statusCode, 200);
  const item = postViewSchema.parse(response.json().items[0]);
  assert.deepEqual(
    item.matchedKeywords.map((keyword) => keyword.value),
    ["VSF", "Vin Future"],
  );
  assert.equal(item.sentiment, null);
  assert.deepEqual(item.author, {
    authorName: null,
    isAnonymous: false,
    authorKind: "unknown",
  });
  assert.match(querySql, /FROM keyword_hits AS hit/u);
  assert.match(querySql, /'value', hit\.matched_keyword_value/u);
  assert.match(querySql, /'matchMode', hit\.matched_match_mode/u);
  assert.doesNotMatch(querySql, /JOIN keywords AS keyword ON/u);
});
