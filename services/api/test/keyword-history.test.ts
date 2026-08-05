import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db.js";
import { registerKeywordRoutes } from "../src/routes/keywords.js";

test("keyword removal is a soft disable so historical hits remain", async () => {
  let querySql = "";
  const database = {
    async query(sql: string) {
      querySql = sql;
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Database;
  const app = Fastify({ logger: false });
  registerKeywordRoutes(app, {
    config: loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    database,
  });

  const response = await app.inject({
    method: "DELETE",
    url: "/api/v1/keywords/00000000-0000-4000-8000-000000000004",
  });
  await app.close();

  assert.equal(response.statusCode, 204);
  assert.match(querySql, /UPDATE keywords/u);
  assert.match(querySql, /SET active = false/u);
  assert.doesNotMatch(querySql, /DELETE FROM keywords/u);
});

test("adding a previously removed keyword reactivates its historical row", async () => {
  let querySql = "";
  const now = new Date("2026-08-04T00:00:00.000Z");
  const database = {
    async query(sql: string) {
      querySql = sql;
      return {
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000004",
            platform: "threads",
            value: "VinSmart Future",
            normalized_value: "vinsmart future",
            match_mode: "contains_phrase",
            active: true,
            created_at: now,
            updated_at: now,
          },
        ],
        rowCount: 1,
      };
    },
  } as unknown as Database;
  const app = Fastify({ logger: false });
  registerKeywordRoutes(app, {
    config: loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    database,
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/keywords",
    payload: {
      platform: "threads",
      value: "VinSmart Future",
      matchMode: "contains_phrase",
      active: true,
    },
  });
  await app.close();

  assert.equal(response.statusCode, 201);
  assert.match(querySql, /ON CONFLICT \(workspace_id, platform, normalized_value\)/u);
  assert.match(querySql, /active = EXCLUDED\.active/u);
  assert.equal(response.json().active, true);
});

test("keyword-hit migration freezes value and match mode history", async () => {
  const migration = await readFile(
    new URL(
      "../migrations/006_freeze_keyword_hit_metadata.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /matched_keyword_value/u);
  assert.match(migration, /matched_match_mode/u);
  assert.match(migration, /SET matched_keyword_value = keyword\.value/u);
  assert.match(migration, /ALTER COLUMN matched_keyword_value SET NOT NULL/u);
});
