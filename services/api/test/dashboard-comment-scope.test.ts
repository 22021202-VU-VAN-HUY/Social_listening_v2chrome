import assert from "node:assert/strict";
import test from "node:test";
import { dashboardSummarySchema } from "@listening-social/contracts";
import Fastify from "fastify";
import type { Database } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { registerDashboardRoutes } from "../src/routes/dashboard.js";

test("dashboard separates top-level comments and replies while sentiment stays comment-only", async () => {
  let summarySql = "";
  const database = {
    async query(sql: string) {
      summarySql = sql;
      return {
        rows: [
          {
            total: "4",
            posts: "2",
            comments: "3",
            replies: "1",
            unknown_time: "1",
            relevant: "3",
            positive: "1",
            negative: "1",
            neutral: "1",
            pending_analysis: "1",
          },
        ],
        rowCount: 1,
      };
    },
  } as unknown as Database;
  const app = Fastify({ logger: false });
  registerDashboardRoutes(app, {
    config: loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    database,
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/dashboard/summary",
  });
  await app.close();

  assert.equal(response.statusCode, 200);
  const payload = dashboardSummarySchema.parse(response.json());
  assert.deepEqual(payload, {
    total: 4,
    posts: 2,
    comments: 3,
    replies: 1,
    unknownTime: 1,
    relevant: 3,
    positive: 1,
    negative: 1,
    neutral: 1,
    pendingAnalysis: 1,
  });
  assert.match(summarySql, /count\(DISTINCT post_id\)/u);
  assert.match(summarySql, /parent_comment_id IS NULL/u);
  assert.match(summarySql, /parent_comment_id IS NOT NULL/u);
  assert.doesNotMatch(summarySql, /FROM posts\s+UNION ALL/u);
  assert.match(summarySql, /'comment'::text AS entity_type/u);
});
