import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import { SentimentRepository } from "../src/sentiment/repository.js";

test("claimBatch can only claim comment sentiment work", async () => {
  let claimSql = "";
  const client = {
    async query(sql: string) {
      if (sql.includes("WITH candidates")) {
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
  assert.match(claimSql, /entity_type\s*=\s*'comment'/u);
  assert.doesNotMatch(claimSql, /entity_type\s*=\s*'post'/u);
});
