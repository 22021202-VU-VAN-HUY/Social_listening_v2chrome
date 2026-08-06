import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { Database } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { registerListeningRoutes } from "../src/routes/listening.js";

test("analyze-all queues posts, comments, and replies without a result", async () => {
  let querySql = "";
  let queryParameters: unknown[] = [];
  const database = {
    async query(sql: string, parameters: unknown[] = []) {
      querySql = sql;
      queryParameters = parameters;
      return {
        rows: [{ total: "12", pending: "5", queued: "3" }],
        rowCount: 1,
      };
    },
  } as unknown as Database;
  const config = loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const app = Fastify({ logger: false });
  registerListeningRoutes(app, { config, database });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/sentiment/analyze-all",
  });
  await app.close();

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), {
    total: 12,
    pending: 5,
    queued: 3,
    skippedAlreadyAnalyzed: 7,
    skippedAlreadyQueued: 2,
  });
  assert.deepEqual(queryParameters, [config.workspaceId]);
  assert.match(querySql, /FROM posts AS post/u);
  assert.match(querySql, /FROM comments AS comment/u);
  assert.match(querySql, /JOIN posts AS post/u);
  assert.match(querySql, /comment\.workspace_id = \$1/u);
  assert.match(querySql, /WITH RECURSIVE reply_ancestors/u);
  assert.match(querySql, /ancestry\.depth < 8/u);
  assert.match(querySql, /reply_descendants/u);
  assert.match(querySql, /'comment_with_replies'/u);
  assert.match(querySql, /'targetCommentId'/u);
  assert.match(querySql, /'relation', relation/u);
  assert.match(querySql, /segment_order <= 60/u);
  assert.match(querySql, /left\(post\.body, 4000\) AS post_context/u);
  assert.match(querySql, /conversation_context\.conversation_context/u);
  assert.match(querySql, /conversation_context\.root_comment_id/u);
  assert.match(querySql, /conversation_group_id = EXCLUDED\.conversation_group_id/u);
  assert.match(querySql, /conversation_context = EXCLUDED\.conversation_context/u);
  assert.match(
    querySql,
    /NOT EXISTS \(\s*SELECT 1\s*FROM sentiment_analyses/u,
  );
  assert.match(querySql, /WHERE sentiment_queue\.status = 'failed'/u);
});
