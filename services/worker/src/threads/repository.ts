import type pg from "pg";
import type { ThreadsMappedPost } from "./mapper.js";

export interface ThreadsTask {
  taskId: string;
  jobId: string;
  workspaceId: string;
  sourceId: string;
  keywordId: string;
  keyword: string;
  matchMode: "whole_word" | "contains_phrase";
  attempt: number;
  checkpoint: Record<string, unknown>;
  settingsSnapshot: Record<string, unknown>;
  startedAt: Date;
}

async function appendEvent(
  client: pg.PoolClient,
  jobId: string,
  level: "info" | "warn" | "error",
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const sequence = await client.query<{ event_sequence: string }>(
    `
      UPDATE crawl_jobs
      SET event_sequence = event_sequence + 1, updated_at = now()
      WHERE id = $1
      RETURNING event_sequence
    `,
    [jobId],
  );
  const value = sequence.rows[0]?.event_sequence;
  if (!value) return;
  await client.query(
    `
      INSERT INTO crawl_events (job_id, sequence, level, type, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [jobId, value, level, type, JSON.stringify(payload)],
  );
}

export class ThreadsRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly workspaceId: string,
  ) {}

  async claimTask(): Promise<ThreadsTask | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        task_id: string;
        job_id: string;
        workspace_id: string;
        source_id: string;
        keyword_id: string;
        keyword: string;
        match_mode: "whole_word" | "contains_phrase";
        attempt: number;
        checkpoint: Record<string, unknown>;
        settings_snapshot: Record<string, unknown>;
        started_at: Date | null;
      }>(
        `
          SELECT task.id AS task_id,
                 job.id AS job_id,
                 job.workspace_id,
                 task.source_id,
                 task.keyword_id,
                 keyword.value AS keyword,
                 keyword.match_mode,
                 task.attempt,
                 task.checkpoint,
                 job.settings_snapshot,
                 job.started_at
          FROM crawl_tasks AS task
          JOIN crawl_jobs AS job ON job.id = task.job_id
          JOIN keywords AS keyword ON keyword.id = task.keyword_id
          WHERE job.workspace_id = $1
            AND job.platform = 'threads'
            AND job.type = 'crawl_content'
            AND job.status IN ('queued', 'running', 'interrupted')
            AND job.cancel_requested = false
            AND task.state = 'pending'
            AND (
              task.checkpoint->>'retryAt' IS NULL
              OR (task.checkpoint->>'retryAt')::timestamptz <= now()
            )
          ORDER BY job.created_at, task.created_at
          LIMIT 1
          FOR UPDATE OF task SKIP LOCKED
        `,
        [this.workspaceId],
      );
      const row = result.rows[0];
      if (!row || !row.source_id || !row.keyword_id) {
        await client.query("COMMIT");
        return null;
      }
      const startedAt = row.started_at ?? new Date();
      const claimed = await client.query(
        `
          UPDATE crawl_tasks
          SET state = 'running',
              attempt = attempt + 1,
              started_at = COALESCE(started_at, now()),
              checkpoint = checkpoint - 'retryAt',
              error_code = NULL,
              error_message = NULL,
              updated_at = now()
          WHERE id = $1 AND state = 'pending'
        `,
        [row.task_id],
      );
      if (!claimed.rowCount) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `
          UPDATE crawl_jobs
          SET status = 'running',
              started_at = COALESCE(started_at, now()),
              progress = progress || jsonb_build_object(
                'stage', 'running',
                'lastHeartbeatAt', now()
              ),
              updated_at = now()
          WHERE id = $1 AND status IN ('queued', 'running', 'interrupted')
        `,
        [row.job_id],
      );
      await appendEvent(client, row.job_id, "info", "threads.task_started", {
        taskId: row.task_id,
        keywordId: row.keyword_id,
        attempt: row.attempt + 1,
      });
      await client.query("COMMIT");
      return {
        taskId: row.task_id,
        jobId: row.job_id,
        workspaceId: row.workspace_id,
        sourceId: row.source_id,
        keywordId: row.keyword_id,
        keyword: row.keyword,
        matchMode: row.match_mode,
        attempt: row.attempt + 1,
        checkpoint: row.checkpoint,
        settingsSnapshot: row.settings_snapshot,
        startedAt,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async isTaskActive(task: ThreadsTask): Promise<boolean> {
    const result = await this.pool.query(
      `
        SELECT 1
        FROM crawl_tasks AS task
        JOIN crawl_jobs AS job ON job.id = task.job_id
        WHERE task.id = $1
          AND task.state = 'running'
          AND job.status = 'running'
          AND job.cancel_requested = false
      `,
      [task.taskId],
    );
    return Boolean(result.rowCount);
  }

  async reserveApiCall(task: ThreadsTask, maxRequestsPerJob: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const reserved = await client.query(
        `
          UPDATE crawl_jobs
          SET progress = progress || jsonb_build_object(
                'apiCalls', COALESCE((progress->>'apiCalls')::integer, 0) + 1,
                'lastHeartbeatAt', now()
              ),
              updated_at = now()
          WHERE id = $1
            AND status = 'running'
            AND cancel_requested = false
            AND (
              $2::integer = 0
              OR COALESCE((progress->>'apiCalls')::integer, 0) < $2
            )
        `,
        [task.jobId, maxRequestsPerJob],
      );
      if (!reserved.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `
          UPDATE crawl_tasks
          SET checkpoint = checkpoint || jsonb_build_object(
                'apiCalls', COALESCE((checkpoint->>'apiCalls')::integer, 0) + 1
              ),
              updated_at = now()
          WHERE id = $1 AND state = 'running'
        `,
        [task.taskId],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async savePage(input: {
    task: ThreadsTask;
    posts: ThreadsMappedPost[];
    scannedDelta: number;
    scannedTotal: number;
    nextCursor: string | null;
    pagesFetched: number;
    apiCalls: number;
    matched: number;
    saved: number;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const active = await client.query(
        `
          SELECT 1
          FROM crawl_tasks AS task
          JOIN crawl_jobs AS job ON job.id = task.job_id
          WHERE task.id = $1
            AND task.state = 'running'
            AND job.status = 'running'
            AND job.cancel_requested = false
          FOR UPDATE OF task
        `,
        [input.task.taskId],
      );
      if (!active.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }

      for (const post of input.posts) {
        const postResult = await client.query<{ id: string }>(
          `
            INSERT INTO posts (
              workspace_id, source_id, first_seen_job_id, last_seen_job_id,
              platform, external_id, canonical_url, body, published_at,
              collected_at, time_parse_status, author_name, is_anonymous,
              author_kind, content_hash
            )
            VALUES (
              $1, $2, $3, $3, 'threads', $4, $5, $6, $7,
              now(), 'parsed', NULL, false, 'unknown', $8
            )
            ON CONFLICT (workspace_id, platform, external_id)
            DO UPDATE SET
              source_id = EXCLUDED.source_id,
              last_seen_job_id = EXCLUDED.last_seen_job_id,
              canonical_url = EXCLUDED.canonical_url,
              body = EXCLUDED.body,
              published_at = EXCLUDED.published_at,
              collected_at = EXCLUDED.collected_at,
              time_parse_status = EXCLUDED.time_parse_status,
              author_name = NULL,
              is_anonymous = false,
              author_kind = 'unknown',
              anonymous_avatar_variant = NULL,
              content_hash = EXCLUDED.content_hash,
              updated_at = now()
            RETURNING id
          `,
          [
            input.task.workspaceId,
            input.task.sourceId,
            input.task.jobId,
            post.externalId,
            post.canonicalUrl,
            post.body,
            post.publishedAt,
            post.contentHash,
          ],
        );
        const postId = postResult.rows[0]!.id;
        await client.query(
          `
            INSERT INTO keyword_hits (
              keyword_id, entity_type, entity_id, matched_keyword_value,
              matched_match_mode, match_excerpt
            )
            VALUES ($1, 'post', $2, $3, $4, $5)
            ON CONFLICT (keyword_id, entity_type, entity_id)
            DO UPDATE SET
              matched_keyword_value = EXCLUDED.matched_keyword_value,
              matched_match_mode = EXCLUDED.matched_match_mode,
              match_excerpt = EXCLUDED.match_excerpt
          `,
          [
            input.task.keywordId,
            postId,
            input.task.keyword,
            input.task.matchMode,
            post.matchExcerpt,
          ],
        );
      }

      const checkpoint = {
        afterCursor: input.nextCursor,
        pagesFetched: input.pagesFetched,
        apiCalls: input.apiCalls,
        postsScanned: input.scannedTotal,
        postsMatched: input.matched,
        postsSaved: input.saved,
      };
      await client.query(
        `
          UPDATE crawl_tasks
          SET checkpoint = $2::jsonb, updated_at = now()
          WHERE id = $1
        `,
        [input.task.taskId, JSON.stringify(checkpoint)],
      );
      await client.query(
        `
          UPDATE crawl_jobs
          SET progress = progress || jsonb_build_object(
                'stage', 'running',
                'postsScanned', COALESCE((progress->>'postsScanned')::integer, 0) + $2,
                'postsMatched', COALESCE((progress->>'postsMatched')::integer, 0) + $3,
                'postsSaved', COALESCE((progress->>'postsSaved')::integer, 0) + $4,
                'pagesFetched', COALESCE((progress->>'pagesFetched')::integer, 0) + 1,
                'lastHeartbeatAt', now()
              ),
              updated_at = now()
          WHERE id = $1
        `,
        [input.task.jobId, input.scannedDelta, input.posts.length, input.posts.length],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeTask(task: ThreadsTask, truncated: boolean): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `
          UPDATE crawl_tasks
          SET state = 'completed',
              checkpoint = checkpoint || jsonb_build_object(
                'completed', true,
                'truncated', $2::boolean
              ),
              completed_at = now(),
              updated_at = now()
          WHERE id = $1 AND state = 'running'
        `,
        [task.taskId, truncated],
      );
      if (updated.rowCount) {
        await appendEvent(client, task.jobId, truncated ? "warn" : "info", "threads.task_completed", {
          taskId: task.taskId,
          keywordId: task.keywordId,
          truncated,
        });
      }
      await this.finalizeJob(client, task.jobId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async failTask(
    task: ThreadsTask,
    input: { code: string; message: string; retry: boolean; maxAttempts: number },
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const retry = input.retry && task.attempt < input.maxAttempts;
      const retryAt = new Date(
        Date.now() + Math.min(300, 5 * 2 ** (task.attempt - 1)) * 1_000,
      ).toISOString();
      await client.query(
        `
          UPDATE crawl_tasks
          SET state = $2,
              checkpoint = CASE
                WHEN $2 = 'pending'
                  THEN checkpoint || jsonb_build_object('retryAt', $5::text)
                ELSE checkpoint
              END,
              error_code = $3,
              error_message = $4,
              completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END,
              updated_at = now()
          WHERE id = $1 AND state = 'running'
        `,
        [task.taskId, retry ? "pending" : "failed", input.code, input.message.slice(0, 2_000), retryAt],
      );
      if (retry) {
        await client.query(
          `
            UPDATE crawl_jobs
            SET status = 'queued',
                progress = progress || jsonb_build_object('stage', 'retry_wait'),
                updated_at = now()
            WHERE id = $1 AND status = 'running'
          `,
          [task.jobId],
        );
      }
      await appendEvent(client, task.jobId, retry ? "warn" : "error", retry ? "threads.task_retry" : "threads.task_failed", {
        taskId: task.taskId,
        keywordId: task.keywordId,
        code: input.code,
        attempt: task.attempt,
      });
      await this.finalizeJob(client, task.jobId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setConnectionStatus(
    status: "connected" | "error",
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO platform_connections (
          workspace_id, platform, status, credential_reference, metadata
        )
        VALUES ($1, 'threads', $2, 'env:THREADS_ACCESS_TOKEN', $3::jsonb)
        ON CONFLICT (workspace_id, platform)
        DO UPDATE SET status = EXCLUDED.status,
                      credential_reference = EXCLUDED.credential_reference,
                      metadata = platform_connections.metadata || EXCLUDED.metadata,
                      updated_at = now()
      `,
      [this.workspaceId, status, JSON.stringify(metadata)],
    );
  }

  private async finalizeJob(client: pg.PoolClient, jobId: string): Promise<void> {
    const jobResult = await client.query<{ status: string }>(
      "SELECT status FROM crawl_jobs WHERE id = $1 FOR UPDATE",
      [jobId],
    );
    const current = jobResult.rows[0]?.status;
    if (!current || ["cancelled", "completed", "partial", "failed"].includes(current)) return;
    const countsResult = await client.query<{
      total: string;
      pending: string;
      running: string;
      failed: string;
      completed: string;
      truncated: string;
    }>(
      `
        SELECT count(*)::text AS total,
               count(*) FILTER (WHERE state = 'pending')::text AS pending,
               count(*) FILTER (WHERE state = 'running')::text AS running,
               count(*) FILTER (WHERE state = 'failed')::text AS failed,
               count(*) FILTER (WHERE state = 'completed')::text AS completed,
               count(*) FILTER (
                 WHERE state = 'completed' AND checkpoint->>'truncated' = 'true'
               )::text AS truncated
        FROM crawl_tasks
        WHERE job_id = $1
      `,
      [jobId],
    );
    const counts = countsResult.rows[0]!;
    if (Number(counts.pending) > 0 || Number(counts.running) > 0) return;
    const failed = Number(counts.failed);
    const completed = Number(counts.completed);
    const truncated = Number(counts.truncated);
    const status = completed === 0 && failed > 0
      ? "failed"
      : failed > 0 || truncated > 0
        ? "partial"
        : "completed";
    await client.query(
      `
        UPDATE crawl_jobs
        SET status = $2,
            crawl_outcome = CASE WHEN $2 = 'completed' THEN 'crawl_complete' ELSE 'partial' END,
            progress = progress || jsonb_build_object(
              'stage', $2::text,
              'tasksDone', $3::integer,
              'sourcesDone', 1,
              'coverage', CASE WHEN $2 = 'completed' THEN 'complete' ELSE 'partial' END
            ),
            error_code = CASE WHEN $2 = 'failed' THEN 'THREADS_ALL_TASKS_FAILED' ELSE NULL END,
            error_message = CASE WHEN $2 = 'failed' THEN 'All Threads keyword tasks failed' ELSE NULL END,
            completed_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [jobId, status, failed + completed],
    );
    await appendEvent(client, jobId, status === "completed" ? "info" : "warn", "job.completed", {
      status,
      coverage: status === "completed" ? "complete" : "partial",
    });
  }
}
