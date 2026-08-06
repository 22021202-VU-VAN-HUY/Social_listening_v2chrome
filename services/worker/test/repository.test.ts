import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import { SentimentRepository } from "../src/sentiment/repository.js";

test("claimBatch can claim post and comment sentiment work", async () => {
  let claimSql = "";
  const client = {
    async query(sql: string) {
      if (sql.includes("WITH next_group")) {
        claimSql = sql;
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as pg.Pool;

  const repository = new SentimentRepository(pool);
  assert.deepEqual(await repository.claimBatch(5), []);
  assert.match(claimSql, /entity_type IN \('post', 'comment'\)/u);
  assert.match(
    claimSql,
    /WITH next_group AS/u,
  );
  assert.match(claimSql, /COALESCE\(queue\.conversation_group_id, queue\.entity_id\)/u);
  assert.match(claimSql, /= next_group\.group_id/u);
});
