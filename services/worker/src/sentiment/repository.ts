import type pg from "pg";
import type {
  SentimentQueueItem,
  SentimentResult,
} from "./schema.js";

interface SaveAnalysisInput {
  queueItem: SentimentQueueItem;
  result: SentimentResult;
  inputHash: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  reviewThreshold: number;
}

export class SentimentRepository {
  constructor(private readonly pool: pg.Pool) {}

  async claimBatch(limit: number): Promise<SentimentQueueItem[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string;
        workspace_id: string;
        job_id: string | null;
        entity_type: "post" | "comment";
        entity_id: string;
        text: string;
        post_context: string | null;
        conversation_context: string | null;
        attempt_count: number;
      }>(
        `
          WITH candidates AS (
            SELECT id
            FROM sentiment_queue
            WHERE status IN ('queued', 'retry_wait')
              AND entity_type IN ('post', 'comment')
              AND available_at <= NOW()
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT $1
          )
          UPDATE sentiment_queue AS queue
          SET status = 'processing',
              attempt_count = queue.attempt_count + 1,
              locked_at = NOW(),
              updated_at = NOW()
          FROM candidates
          WHERE queue.id = candidates.id
          RETURNING queue.id,
                    queue.workspace_id,
                    queue.job_id,
                    queue.entity_type,
                    queue.entity_id,
                    queue.text,
                    queue.post_context,
                    queue.conversation_context,
                    queue.attempt_count
        `,
        [limit],
      );
      await client.query("COMMIT");
      return result.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        jobId: row.job_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        text: row.text,
        postContext: row.post_context,
        conversationContext: row.conversation_context,
        attemptCount: row.attempt_count,
      }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findCachedAnalysis(
    inputHash: string,
    provider: string,
    model: string,
    promptVersion: string,
    schemaVersion: string,
  ): Promise<SentimentResult | null> {
    const result = await this.pool.query<{
      is_relevant: boolean;
      label: "positive" | "negative" | "neutral";
      confidence: number;
      reason: string;
      language: string;
    }>(
      `
        SELECT is_relevant, label, confidence, reason, language
        FROM sentiment_analyses
        WHERE analysis_input_hash = $1
          AND provider = $2
          AND model = $3
          AND prompt_version = $4
          AND schema_version = $5
        ORDER BY analyzed_at DESC
        LIMIT 1
      `,
      [inputHash, provider, model, promptVersion, schemaVersion],
    );

    const row = result.rows[0];
    return row
      ? {
          isRelevant: row.is_relevant,
          label: row.label,
          confidence: Number(row.confidence),
          reason: row.reason,
          language: row.language,
        }
      : null;
  }

  async complete(input: SaveAnalysisInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO sentiment_analyses (
            workspace_id,
            entity_type,
            entity_id,
            analysis_input_hash,
            is_relevant,
            label,
            confidence,
            reason,
            language,
            provider,
            model,
            prompt_version,
            schema_version,
            needs_review,
            analyzed_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
          ON CONFLICT (
            entity_type,
            entity_id,
            analysis_input_hash,
            provider,
            model,
            prompt_version,
            schema_version
          )
          DO UPDATE SET
            is_relevant = EXCLUDED.is_relevant,
            label = EXCLUDED.label,
            confidence = EXCLUDED.confidence,
            reason = EXCLUDED.reason,
            language = EXCLUDED.language,
            needs_review = EXCLUDED.needs_review,
            analyzed_at = NOW()
        `,
        [
          input.queueItem.workspaceId,
          input.queueItem.entityType,
          input.queueItem.entityId,
          input.inputHash,
          input.result.isRelevant,
          input.result.label,
          input.result.confidence,
          input.result.reason,
          input.result.language,
          input.provider,
          input.model,
          input.promptVersion,
          input.schemaVersion,
          input.result.confidence < input.reviewThreshold,
        ],
      );
      await client.query(
        `
          UPDATE sentiment_queue
          SET status = 'completed',
              completed_at = NOW(),
              updated_at = NOW(),
              last_error = NULL
          WHERE id = $1
        `,
        [input.queueItem.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(
    item: SentimentQueueItem,
    error: unknown,
    maxAttempts: number,
  ): Promise<void> {
    const isFinal = item.attemptCount >= maxAttempts;
    const backoffSeconds = Math.min(
      300,
      Math.max(5, 2 ** item.attemptCount * 5),
    );
    const message =
      error instanceof Error ? error.message.slice(0, 1_000) : "Unknown error";

    await this.pool.query(
      `
        UPDATE sentiment_queue
        SET status = $2,
            available_at = CASE
              WHEN $2 = 'retry_wait'
                THEN NOW() + ($3 * INTERVAL '1 second')
              ELSE available_at
            END,
            last_error = $4,
            updated_at = NOW()
        WHERE id = $1
      `,
      [item.id, isFinal ? "failed" : "retry_wait", backoffSeconds, message],
    );
  }
}
