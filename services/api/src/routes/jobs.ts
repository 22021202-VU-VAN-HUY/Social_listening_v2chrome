import {
  cancelJobSchema,
  createCrawlJobSchema,
  createDiscoverSourcesJobSchema,
  idSchema,
  jobEventsQuerySchema,
  jobStatusSchema,
  platformSchema,
} from "@listening-social/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import type { Transaction } from "../db.js";
import { inTransaction } from "../db.js";
import { appendJobEvent } from "../events.js";
import { ApiError, conflict, notFound } from "../errors.js";
import { calculateWindow } from "../time-window.js";
import { toIso } from "../serialize.js";
import { parseWith } from "../validation.js";

const jobParamsSchema = z.object({ id: idSchema }).strict();
const jobListQuerySchema = z
  .object({
    platform: platformSchema.optional(),
    status: jobStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

interface DeviceRow {
  id: string;
}

interface JobRow {
  id: string;
  type:
    | "discover_sources"
    | "crawl_content"
    | "analyze_sentiment"
    | "rebuild_aggregates"
    | "delete_expired_data";
  platform: "facebook" | "tiktok" | "threads";
  status:
    | "queued"
    | "waiting_extension"
    | "running"
    | "processing_ai"
    | "interrupted"
    | "needs_login"
    | "partial"
    | "cancelled"
    | "failed"
    | "completed";
  cancel_requested: boolean;
  settings_snapshot: Record<string, unknown>;
  progress: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

function serializeJob(row: JobRow) {
  return {
    id: row.id,
    type: row.type,
    platform: row.platform,
    status: row.status,
    cancelRequested: row.cancel_requested,
    settingsSnapshot: row.settings_snapshot,
    progress: row.progress,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: toIso(row.created_at),
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
  };
}

async function refreshSentimentProgress(
  transaction: Transaction,
  jobId: string,
): Promise<void> {
  await transaction.query(
    `
      WITH sentiment AS (
        SELECT count(*)::integer AS total,
               count(*) FILTER (WHERE status = 'completed')::integer AS done,
               count(*) FILTER (
                 WHERE status IN ('queued', 'processing', 'retry_wait')
               )::integer AS pending,
               count(*) FILTER (WHERE status = 'failed')::integer AS failed
        FROM sentiment_queue
        WHERE job_id = $1
      )
      UPDATE crawl_jobs AS job
      SET progress = jsonb_set(
            jsonb_set(
              job.progress,
              '{sentimentTotal}',
              to_jsonb(sentiment.total)
            ),
            '{sentimentDone}',
            to_jsonb(sentiment.done)
          ),
          status = CASE
            WHEN job.status = 'processing_ai' AND sentiment.pending = 0
              THEN CASE
                WHEN job.crawl_outcome = 'partial' OR sentiment.failed > 0
                  THEN 'partial'
                ELSE 'completed'
              END
            ELSE job.status
          END,
          completed_at = CASE
            WHEN job.status = 'processing_ai' AND sentiment.pending = 0
              THEN COALESCE(job.completed_at, now())
            ELSE job.completed_at
          END,
          updated_at = CASE
            WHEN job.status = 'processing_ai' THEN now()
            ELSE job.updated_at
          END
      FROM sentiment
      WHERE job.id = $1
        AND job.type = 'crawl_content'
    `,
    [jobId],
  );
}

async function findOnlineDevice(
  transaction: Transaction,
  context: AppContext,
  requestedDeviceId: string | undefined,
): Promise<DeviceRow> {
  const values: unknown[] = [
    context.config.workspaceId,
    context.config.deviceOnlineSeconds,
  ];
  let requestedFilter = "";
  if (requestedDeviceId) {
    values.push(requestedDeviceId);
    requestedFilter = `AND id = $${values.length}`;
  }
  const result = await transaction.query<DeviceRow>(
    `
      SELECT id
      FROM extension_devices
      WHERE workspace_id = $1
        AND revoked_at IS NULL
        AND last_seen_at >= now() - ($2 * interval '1 second')
        ${requestedFilter}
      ORDER BY last_seen_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    values,
  );
  const device = result.rows[0];
  if (!device) {
    throw new ApiError(
      409,
      "EXTENSION_OFFLINE",
      "A paired and recently active Facebook extension is required",
    );
  }
  return device;
}

async function ensureDeviceHasNoActiveFacebookJob(
  transaction: Transaction,
  deviceId: string,
): Promise<void> {
  const active = await transaction.query(
    `
      SELECT 1
      FROM crawl_jobs
      WHERE extension_device_id = $1
        AND platform = 'facebook'
        AND status IN (
          'queued',
          'waiting_extension',
          'running',
          'processing_ai',
          'interrupted'
        )
      LIMIT 1
    `,
    [deviceId],
  );
  if (active.rowCount) {
    conflict(
      "DEVICE_ALREADY_BUSY",
      "This extension device already owns an unfinished Facebook job",
    );
  }
}

async function createThreadsCrawlJob(
  transaction: Transaction,
  context: AppContext,
  input: {
    sourceIds?: string[] | undefined;
    keywordIds?: string[] | undefined;
    lookbackPreset?: "today" | "3_days" | "7_days" | "30_days" | undefined;
  },
): Promise<ReturnType<typeof serializeJob>> {
  if (input.sourceIds) {
    throw new ApiError(
      400,
      "THREADS_SOURCE_FILTER_UNSUPPORTED",
      "Threads keyword search uses its managed public-search source",
    );
  }

  const activeJob = await transaction.query(
    `
      SELECT 1
      FROM crawl_jobs
      WHERE workspace_id = $1
        AND platform = 'threads'
        AND status IN ('queued', 'running', 'interrupted')
      LIMIT 1
      FOR UPDATE
    `,
    [context.config.workspaceId],
  );
  if (activeJob.rowCount) {
    conflict(
      "THREADS_JOB_ALREADY_ACTIVE",
      "This workspace already has an unfinished Threads job",
    );
  }

  const settingsResult = await transaction.query<{
    lookback_preset: "today" | "3_days" | "7_days" | "30_days";
    max_posts_per_source: number;
    max_runtime_minutes: number;
    enabled: boolean;
    timezone: string;
  }>(
    `
      SELECT settings.lookback_preset,
             settings.max_posts_per_source,
             settings.max_runtime_minutes,
             settings.enabled,
             workspace.timezone
      FROM platform_settings AS settings
      JOIN workspaces AS workspace ON workspace.id = settings.workspace_id
      WHERE settings.workspace_id = $1 AND settings.platform = 'threads'
      FOR UPDATE OF settings
    `,
    [context.config.workspaceId],
  );
  const settings = settingsResult.rows[0];
  if (!settings?.enabled) {
    throw new ApiError(
      409,
      "THREADS_CONNECTOR_DISABLED",
      "Enable the Threads connector in platform settings first",
    );
  }

  const keywordResult = await transaction.query<{
    id: string;
    value: string;
    normalized_value: string;
    match_mode: "whole_word" | "contains_phrase";
  }>(
    `
      SELECT id, value, normalized_value, match_mode
      FROM keywords
      WHERE workspace_id = $1
        AND platform = 'threads'
        AND active = true
        AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
      ORDER BY created_at
    `,
    [context.config.workspaceId, input.keywordIds ?? null],
  );
  if (keywordResult.rows.length === 0) {
    throw new ApiError(
      400,
      "NO_ACTIVE_KEYWORDS",
      "Enable at least one Threads keyword",
    );
  }

  const sourceResult = await transaction.query<{
    id: string;
    external_id: string;
    name: string;
    canonical_url: string;
  }>(
    `
      INSERT INTO sources (
        workspace_id, platform, external_id, name, canonical_url, active
      )
      VALUES (
        $1, 'threads', 'threads:public-keyword-search',
        'Threads public keyword search',
        'https://www.threads.com/search', true
      )
      ON CONFLICT (workspace_id, platform, external_id)
      DO UPDATE SET active = true, updated_at = now()
      RETURNING id, external_id, name, canonical_url
    `,
    [context.config.workspaceId],
  );
  const source = sourceResult.rows[0]!;
  await transaction.query(
    `
      INSERT INTO source_selections (workspace_id, source_id, selected, selected_at)
      VALUES ($1, $2, true, now())
      ON CONFLICT (workspace_id, source_id)
      DO UPDATE SET selected = true, selected_at = now(), updated_at = now()
    `,
    [context.config.workspaceId, source.id],
  );

  const createdAt = new Date();
  const lookbackPreset = input.lookbackPreset ?? settings.lookback_preset;
  const window = calculateWindow(lookbackPreset, createdAt, settings.timezone);
  const snapshot = {
    connector: "threads-keyword-search-v1",
    sourceIds: [source.id],
    keywordIds: keywordResult.rows.map((keyword) => keyword.id),
    keywords: keywordResult.rows.map((keyword) => ({
      id: keyword.id,
      value: keyword.value,
      normalizedValue: keyword.normalized_value,
      matchMode: keyword.match_mode,
    })),
    searchType: "RECENT",
    searchMode: "KEYWORD",
    requestedFields: [
      "id",
      "text",
      "timestamp",
      "permalink",
      "is_reply",
    ],
    windowStartUtc: window.start.toISOString(),
    windowEndUtc: window.end.toISOString(),
    timezone: settings.timezone,
    lookbackPreset,
    crawlComments: false,
    limits: {
      maxPostsPerSource: settings.max_posts_per_source,
      maxRuntimeMinutes: settings.max_runtime_minutes,
    },
  };
  const progress = {
    stage: "queued",
    currentSource: source.name,
    sourcesTotal: 1,
    sourcesDone: 0,
    tasksTotal: keywordResult.rows.length,
    tasksDone: 0,
    postsScanned: 0,
    postsMatched: 0,
    postsSaved: 0,
    commentsSaved: 0,
    pagesFetched: 0,
    apiCalls: 0,
    sentimentTotal: 0,
    sentimentDone: 0,
    lastHeartbeatAt: null,
  };
  const result = await transaction.query<JobRow>(
    `
      INSERT INTO crawl_jobs (
        workspace_id, type, platform, status, settings_snapshot, progress,
        created_at
      )
      VALUES ($1, 'crawl_content', 'threads', 'queued', $2::jsonb, $3::jsonb, $4)
      RETURNING *
    `,
    [
      context.config.workspaceId,
      JSON.stringify(snapshot),
      JSON.stringify(progress),
      createdAt,
    ],
  );
  const row = result.rows[0]!;
  for (const keyword of keywordResult.rows) {
    await transaction.query(
      `
        INSERT INTO crawl_tasks (job_id, source_id, keyword_id)
        VALUES ($1, $2, $3)
      `,
      [row.id, source.id, keyword.id],
    );
  }
  await appendJobEvent(transaction, row.id, "info", "job.created", {
    type: "crawl_content",
    connector: "threads-keyword-search-v1",
    tasksTotal: keywordResult.rows.length,
  });
  return serializeJob(row);
}

export function registerJobRoutes(app: FastifyInstance, context: AppContext): void {
  app.post("/api/v1/jobs/discover-sources", async (request, reply) => {
    const input = parseWith(createDiscoverSourcesJobSchema, request.body);
    const job = await inTransaction(context.database, async (transaction) => {
      const device = await findOnlineDevice(transaction, context, input.deviceId);
      await ensureDeviceHasNoActiveFacebookJob(transaction, device.id);
      const progress = {
        stage: "waiting_extension",
        sourcesTotal: 0,
        sourcesDone: 0,
        tasksTotal: 1,
        tasksDone: 0,
        postsScanned: 0,
        postsMatched: 0,
        postsSaved: 0,
        commentsSaved: 0,
        sentimentTotal: 0,
        sentimentDone: 0,
        lastHeartbeatAt: null,
      };
      const result = await transaction.query<JobRow>(
        `
          INSERT INTO crawl_jobs (
            workspace_id,
            extension_device_id,
            type,
            platform,
            status,
            settings_snapshot,
            progress
          )
          VALUES (
            $1, $2, 'discover_sources', 'facebook', 'waiting_extension',
            $3::jsonb, $4::jsonb
          )
          RETURNING *
        `,
        [
          context.config.workspaceId,
          device.id,
          JSON.stringify({ adapterVersion: context.config.adapterVersion }),
          JSON.stringify(progress),
        ],
      );
      const row = result.rows[0]!;
      await transaction.query(
        "INSERT INTO crawl_tasks (job_id, state) VALUES ($1, 'pending')",
        [row.id],
      );
      await appendJobEvent(
        transaction,
        row.id,
        "info",
        "job.created",
        { type: "discover_sources" },
      );
      return serializeJob(row);
    });
    return reply.code(201).send(job);
  });

  app.post("/api/v1/jobs/crawl", async (request, reply) => {
    const input = parseWith(createCrawlJobSchema, request.body);
    const job = await inTransaction(context.database, async (transaction) => {
      if (input.platform === "threads") {
        return createThreadsCrawlJob(transaction, context, input);
      }
      const device = await findOnlineDevice(transaction, context, input.deviceId);
      await ensureDeviceHasNoActiveFacebookJob(transaction, device.id);

      const settingsResult = await transaction.query<{
        lookback_preset: "today" | "3_days" | "7_days" | "30_days";
        crawl_comments: boolean;
        max_sources_per_job: number;
        max_posts_per_source: number;
        max_comments_per_post: number;
        max_runtime_minutes: number;
        enabled: boolean;
        timezone: string;
      }>(
        `
          SELECT settings.lookback_preset,
                 settings.crawl_comments,
                 settings.max_sources_per_job,
                 settings.max_posts_per_source,
                 settings.max_comments_per_post,
                 settings.max_runtime_minutes,
                 settings.enabled,
                 workspace.timezone
          FROM platform_settings AS settings
          JOIN workspaces AS workspace ON workspace.id = settings.workspace_id
          WHERE settings.workspace_id = $1 AND settings.platform = 'facebook'
          FOR UPDATE OF settings
        `,
        [context.config.workspaceId],
      );
      const settings = settingsResult.rows[0];
      if (!settings?.enabled) {
        throw new ApiError(
          409,
          "FACEBOOK_CONNECTOR_DISABLED",
          "The Facebook connector is disabled",
        );
      }

      const sourceResult = await transaction.query<{
        id: string;
        external_id: string;
        name: string;
        canonical_url: string;
      }>(
        `
          SELECT source.id, source.external_id, source.name, source.canonical_url
          FROM sources AS source
          JOIN source_selections AS selection
            ON selection.workspace_id = source.workspace_id
           AND selection.source_id = source.id
          WHERE source.workspace_id = $1
            AND source.platform = 'facebook'
            AND source.active = true
            AND selection.selected = true
            AND ($2::uuid[] IS NULL OR source.id = ANY($2::uuid[]))
          ORDER BY source.name
        `,
        [context.config.workspaceId, input.sourceIds ?? null],
      );
      if (sourceResult.rows.length === 0) {
        throw new ApiError(
          400,
          "NO_SELECTED_SOURCES",
          "Select at least one active Facebook group",
        );
      }
      if (sourceResult.rows.length > settings.max_sources_per_job) {
        throw new ApiError(
          400,
          "SOURCE_LIMIT_EXCEEDED",
          `At most ${settings.max_sources_per_job} sources may be crawled per job`,
        );
      }

      const keywordResult = await transaction.query<{
        id: string;
        value: string;
        normalized_value: string;
        match_mode: "whole_word" | "contains_phrase";
      }>(
        `
          SELECT id, value, normalized_value, match_mode
          FROM keywords
          WHERE workspace_id = $1
            AND platform = 'facebook'
            AND active = true
            AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
          ORDER BY created_at
        `,
        [context.config.workspaceId, input.keywordIds ?? null],
      );
      if (keywordResult.rows.length === 0) {
        throw new ApiError(
          400,
          "NO_ACTIVE_KEYWORDS",
          "Enable at least one Facebook keyword",
        );
      }

      const createdAt = new Date();
      const lookbackPreset = input.lookbackPreset ?? settings.lookback_preset;
      const window = calculateWindow(lookbackPreset, createdAt, settings.timezone);
      const snapshot = {
        sources: sourceResult.rows.map((source) => ({
          id: source.id,
          externalId: source.external_id,
          name: source.name,
          canonicalUrl: source.canonical_url,
        })),
        sourceIds: sourceResult.rows.map((source) => source.id),
        keywordIds: keywordResult.rows.map((keyword) => keyword.id),
        keywords: keywordResult.rows.map((keyword) => ({
          id: keyword.id,
          value: keyword.value,
          normalizedValue: keyword.normalized_value,
          matchMode: keyword.match_mode,
        })),
        windowStartUtc: window.start.toISOString(),
        windowEndUtc: window.end.toISOString(),
        timezone: settings.timezone,
        lookbackPreset,
        crawlComments: true,
        limits: {
          maxSourcesPerJob: settings.max_sources_per_job,
          maxPostsPerSource: settings.max_posts_per_source,
          maxCommentsPerPost: settings.max_comments_per_post,
          maxRuntimeMinutes: settings.max_runtime_minutes,
        },
        adapterVersion: context.config.adapterVersion,
      };
      const tasksTotal = sourceResult.rows.length * keywordResult.rows.length;
      const progress = {
        stage: "waiting_extension",
        currentSource: null,
        sourcesTotal: sourceResult.rows.length,
        sourcesDone: 0,
        tasksTotal,
        tasksDone: 0,
        postsScanned: 0,
        postsMatched: 0,
        postsSaved: 0,
        commentsSaved: 0,
        sentimentTotal: 0,
        sentimentDone: 0,
        lastHeartbeatAt: null,
      };
      const result = await transaction.query<JobRow>(
        `
          INSERT INTO crawl_jobs (
            workspace_id,
            extension_device_id,
            type,
            platform,
            status,
            settings_snapshot,
            progress,
            created_at
          )
          VALUES (
            $1, $2, 'crawl_content', 'facebook', 'waiting_extension',
            $3::jsonb, $4::jsonb, $5
          )
          RETURNING *
        `,
        [
          context.config.workspaceId,
          device.id,
          JSON.stringify(snapshot),
          JSON.stringify(progress),
          createdAt,
        ],
      );
      const row = result.rows[0]!;
      for (const source of sourceResult.rows) {
        for (const keyword of keywordResult.rows) {
          await transaction.query(
            `
              INSERT INTO crawl_tasks (job_id, source_id, keyword_id)
              VALUES ($1, $2, $3)
            `,
            [row.id, source.id, keyword.id],
          );
        }
      }
      await appendJobEvent(
        transaction,
        row.id,
        "info",
        "job.created",
        {
          type: "crawl_content",
          sourcesTotal: sourceResult.rows.length,
          tasksTotal,
        },
      );
      return serializeJob(row);
    });
    return reply.code(201).send(job);
  });

  app.get("/api/v1/jobs", async (request) => {
    const query = parseWith(jobListQuerySchema, request.query);
    const values: unknown[] = [context.config.workspaceId];
    const conditions = ["workspace_id = $1"];
    if (query.platform) {
      values.push(query.platform);
      conditions.push(`platform = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      conditions.push(`status = $${values.length}`);
    }
    values.push(query.limit);
    const result = await context.database.query<JobRow>(
      `
        SELECT *
        FROM crawl_jobs
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${values.length}
      `,
      values,
    );
    return { items: result.rows.map(serializeJob) };
  });

  app.get("/api/v1/jobs/:id", async (request) => {
    const { id } = parseWith(jobParamsSchema, request.params);
    return inTransaction(context.database, async (transaction) => {
      await refreshSentimentProgress(transaction, id);
      const result = await transaction.query<JobRow>(
        "SELECT * FROM crawl_jobs WHERE id = $1 AND workspace_id = $2",
        [id, context.config.workspaceId],
      );
      const job = result.rows[0];
      if (!job) {
        return notFound("Job not found");
      }
      return serializeJob(job);
    });
  });

  app.get("/api/v1/jobs/:id/events", async (request) => {
    const { id } = parseWith(jobParamsSchema, request.params);
    const query = parseWith(jobEventsQuerySchema, request.query);
    const exists = await context.database.query(
      "SELECT 1 FROM crawl_jobs WHERE id = $1 AND workspace_id = $2",
      [id, context.config.workspaceId],
    );
    if (!exists.rowCount) {
      return notFound("Job not found");
    }
    const result = await context.database.query<{
      sequence: string;
      level: "debug" | "info" | "warn" | "error";
      type: string;
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `
        SELECT sequence, level, type, payload, created_at
        FROM crawl_events
        WHERE job_id = $1 AND sequence > $2
        ORDER BY sequence
        LIMIT $3
      `,
      [id, query.after, query.limit],
    );
    return {
      items: result.rows.map((event) => ({
        sequence: Number(event.sequence),
        level: event.level,
        type: event.type,
        payload: event.payload,
        createdAt: toIso(event.created_at),
      })),
    };
  });

  app.post("/api/v1/jobs/:id/cancel", async (request) => {
    const { id } = parseWith(jobParamsSchema, request.params);
    const input = parseWith(cancelJobSchema, request.body);
    return inTransaction(context.database, async (transaction) => {
      const result = await transaction.query<{
        status: JobRow["status"];
        has_active_lease: boolean;
      }>(
        `
          SELECT job.status,
                 EXISTS (
                   SELECT 1
                   FROM crawler_slots AS slot
                   WHERE slot.job_id = job.id
                     AND slot.lease_expires_at > now()
                 ) AS has_active_lease
          FROM crawl_jobs AS job
          WHERE job.id = $1 AND job.workspace_id = $2
          FOR UPDATE OF job
        `,
        [id, context.config.workspaceId],
      );
      const job = result.rows[0];
      if (!job) {
        return notFound("Job not found");
      }
      if (["completed", "partial", "cancelled", "failed"].includes(job.status)) {
        return { id, status: job.status, cancelRequested: false };
      }
      const cancelImmediately = [
        "queued",
        "waiting_extension",
        "interrupted",
        "needs_login",
      ].includes(job.status) || !job.has_active_lease;
      const nextStatus = cancelImmediately ? "cancelled" : job.status;
      await transaction.query(
        `
          UPDATE crawl_jobs
          SET cancel_requested = true,
              status = $3,
              completed_at = CASE WHEN $4 THEN now() ELSE completed_at END,
              progress = jsonb_set(progress, '{stage}', to_jsonb($3::text)),
              updated_at = now()
          WHERE id = $1 AND workspace_id = $2
        `,
        [id, context.config.workspaceId, nextStatus, cancelImmediately],
      );
      if (cancelImmediately) {
        await transaction.query(
          "DELETE FROM crawler_slots WHERE job_id = $1",
          [id],
        );
        await transaction.query(
          `
            UPDATE crawl_tasks
            SET state = CASE WHEN state = 'completed' THEN state ELSE 'skipped' END,
                completed_at = COALESCE(completed_at, now()),
                updated_at = now()
            WHERE job_id = $1
          `,
          [id],
        );
      }
      await appendJobEvent(
        transaction,
        id,
        "warn",
        "job.cancel_requested",
        input.reason ? { reason: input.reason } : {},
      );
      return { id, status: nextStatus, cancelRequested: true };
    });
  });
}
