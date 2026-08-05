import assert from "node:assert/strict";
import test from "node:test";

import type { Transaction } from "../src/db.js";
import { findPreviouslySeenPostUrls } from "../src/known-posts.js";

test("known Facebook links are matched by their canonical post identity", async () => {
  let querySql = "";
  let queryParameters: unknown[] = [];
  const transaction = {
    async query(sql: string, parameters: unknown[]) {
      querySql = sql;
      queryParameters = parameters;
      return { rows: [{ external_id: "post-123" }], rowCount: 1 };
    },
  } as unknown as Transaction;
  const knownRawUrl =
    "https://www.facebook.com/groups/group-456/posts/post-123/?fbclid=tracking";
  const newUrl =
    "https://www.facebook.com/groups/group-456/posts/post-999/";

  const result = await findPreviouslySeenPostUrls(transaction, {
    workspaceId: "workspace-1",
    jobId: "current-job",
    platform: "facebook",
    urls: [knownRawUrl, newUrl],
  });

  assert.deepEqual(result, [knownRawUrl]);
  assert.deepEqual(queryParameters, [
    "workspace-1",
    "facebook",
    ["post-123", "post-999"],
    "current-job",
  ]);
  assert.match(querySql, /first_seen_job_id IS DISTINCT FROM \$4/u);
});

test("Threads username and post URL variants resolve to one shortcode", async () => {
  const transaction = {
    async query(_sql: string, parameters: unknown[]) {
      assert.deepEqual(parameters[2], ["THREAD_ABC"]);
      return { rows: [{ external_id: "THREAD_ABC" }], rowCount: 1 };
    },
  } as unknown as Transaction;
  const rawUrl =
    "https://www.threads.com/@example/post/THREAD_ABC?utm_source=test";

  const result = await findPreviouslySeenPostUrls(transaction, {
    workspaceId: "workspace-1",
    jobId: "current-job",
    platform: "threads",
    urls: [rawUrl],
  });

  assert.deepEqual(result, [rawUrl]);
});
