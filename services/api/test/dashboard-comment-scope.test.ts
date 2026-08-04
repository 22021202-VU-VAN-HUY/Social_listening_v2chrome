import assert from "node:assert/strict";
import test from "node:test";
import { dashboardSummarySchema } from "@listening-social/contracts";
import Fastify from "fastify";
import type { Database } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { registerDashboardRoutes } from "../src/routes/dashboard.js";

test("dashboard folds replies into the overall comment report", async () => {
  let summarySql = "";
  const database = {
    async query(sql: string) {
      summarySql = sql;
      return {
        rows: [
          {
            total: "4",
            posts: "2",
            comments: "4",
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
    comments: 4,
    replies: 1,
    unknownTime: 1,
    relevant: 3,
    positive: 1,
    negative: 1,
    neutral: 1,
    pendingAnalysis: 1,
  });
  assert.match(summarySql, /count\(\*\)::text AS total/u);
  assert.match(summarySql, /count\(\*\)::text AS comments/u);
  assert.match(summarySql, /count\(DISTINCT post_id\)::text AS posts/u);
  assert.match(summarySql, /WHERE label = 'positive'/u);
  assert.match(summarySql, /parent_comment_id IS NOT NULL/u);
  assert.doesNotMatch(summarySql, /parent_comment_id IS NULL/u);
  assert.doesNotMatch(summarySql, /FROM posts\s+UNION ALL/u);
  assert.match(summarySql, /'comment'::text AS entity_type/u);
});

test("dashboard timeline includes replies in sentiment ratios", async () => {
  let timelineSql = "";
  const database = {
    async query(sql: string) {
      timelineSql = sql;
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Database;
  const app = Fastify({ logger: false });
  registerDashboardRoutes(app, {
    config: loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    database,
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/dashboard/timeline",
  });
  await app.close();

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { items: [] });
  assert.match(timelineSql, /WHERE label IS NOT NULL/u);
  assert.doesNotMatch(timelineSql, /parent_comment_id IS NULL/u);
});
