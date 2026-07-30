import type { Transaction } from "./db.js";

export async function appendJobEvent(
  transaction: Transaction,
  jobId: string,
  level: "debug" | "info" | "warn" | "error",
  type: string,
  payload: Record<string, unknown> = {},
): Promise<number> {
  const sequenceResult = await transaction.query<{ event_sequence: string }>(
    `
      UPDATE crawl_jobs
      SET event_sequence = event_sequence + 1,
          updated_at = now()
      WHERE id = $1
      RETURNING event_sequence
    `,
    [jobId],
  );
  const sequenceRow = sequenceResult.rows[0];
  if (!sequenceRow) {
    throw new Error("Cannot append an event to a missing job");
  }
  const sequence = Number(sequenceRow.event_sequence);
  await transaction.query(
    `
      INSERT INTO crawl_events (job_id, sequence, level, type, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [jobId, sequence, level, type, JSON.stringify(payload)],
  );
  return sequence;
}
