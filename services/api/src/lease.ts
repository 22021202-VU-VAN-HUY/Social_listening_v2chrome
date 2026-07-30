import type { Transaction } from "./db.js";
import { ApiError } from "./errors.js";
import { secretMatches } from "./security.js";

export async function assertActiveLease(
  transaction: Transaction,
  input: {
    deviceId: string;
    jobId: string;
    leaseToken: string;
    fencingToken: number;
  },
): Promise<void> {
  const result = await transaction.query<{
    lease_token_hash: string;
    fencing_token: string;
    lease_expires_at: Date;
  }>(
    `
      SELECT lease_token_hash, fencing_token, lease_expires_at
      FROM crawler_slots
      WHERE extension_device_id = $1
        AND platform = 'facebook'
        AND job_id = $2
      FOR UPDATE
    `,
    [input.deviceId, input.jobId],
  );
  const lease = result.rows[0];
  const valid =
    lease !== undefined &&
    Number(lease.fencing_token) === input.fencingToken &&
    lease.lease_expires_at.getTime() > Date.now() &&
    secretMatches(input.leaseToken, lease.lease_token_hash);

  if (!valid) {
    throw new ApiError(
      409,
      "STALE_OR_INVALID_LEASE",
      "The crawl lease expired or was replaced by a newer runner",
    );
  }
}
