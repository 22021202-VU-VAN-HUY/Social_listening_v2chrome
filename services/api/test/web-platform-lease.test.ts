import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "../src/db.js";
import { assertActiveLease } from "../src/lease.js";
import { hashSecret } from "../src/security.js";

test("active lease lookup works for both Facebook and Threads slots", async () => {
  const leaseToken = "threads-lease-token-with-enough-entropy";
  let querySql = "";
  const transaction = {
    async query(sql: string) {
      querySql = sql;
      return {
        rows: [
          {
            lease_token_hash: hashSecret(leaseToken),
            fencing_token: "3",
            lease_expires_at: new Date(Date.now() + 60_000),
          },
        ],
        rowCount: 1,
      };
    },
  } as unknown as Transaction;

  await assertActiveLease(transaction, {
    deviceId: "00000000-0000-4000-8000-000000000010",
    jobId: "00000000-0000-4000-8000-000000000011",
    leaseToken,
    fencingToken: 3,
  });

  assert.match(querySql, /extension_device_id = \$1/u);
  assert.match(querySql, /job_id = \$2/u);
  assert.doesNotMatch(querySql, /platform = 'facebook'/u);
});
