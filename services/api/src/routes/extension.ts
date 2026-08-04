import {
  claimJobSchema,
  completeJobSchema,
  createPairingCodeSchema,
  extensionEventSchema,
  extensionHeartbeatSchema,
  failJobSchema,
  idSchema,
  idempotencyKeySchema,
  ingestBatchSchema,
  pairExtensionSchema,
} from "@listening-social/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { inTransaction, type Transaction } from "../db.js";
import { appendJobEvent } from "../events.js";
import { ApiError, conflict, notFound } from "../errors.js";
import { ingestContentBatch, ingestSourceBatch } from "../ingest.js";
import { assertActiveLease } from "../lease.js";
import { assertNoIdentityTrackingFields } from "../privacy.js";
import {
  authenticateDevice,
  hashSecret,
  randomOpaqueToken,
  randomPairingCode,
} from "../security.js";
import { toIso } from "../serialize.js";
import { parseWith } from "../validation.js";

const jobParamsSchema = z.object({ id: idSchema }).strict();
const deviceParamsSchema = z.object({ id: idSchema }).strict();

function idempotencyKeyFrom(headers: Record<string, unknown>): string {
  const value = headers["idempotency-key"];
  return parseWith(
    idempotencyKeySchema,
    Array.isArray(value) ? value[0] : value,
  );
}

async function reconcileExpiredDeviceLeases(
  transaction: Transaction,
  deviceId: string,
): Promise<void> {
  const expired = await transaction.query<{
    id: string;
    status: "cancelled" | "interrupted";
  }>(
    `
      WITH expired_slots AS (
        DELETE FROM crawler_slots
        WHERE extension_device_id = $1
          AND lease_expires_at <= now()
        RETURNING job_id
      )
      UPDATE crawl_jobs AS job
      SET status = CASE
            WHEN job.cancel_requested THEN 'cancelled'
            ELSE 'interrupted'
          END,
          error_code = CASE
            WHEN job.cancel_requested THEN job.error_code
            ELSE 'LEASE_EXPIRED'
          END,
          error_message = CASE
            WHEN job.cancel_requested THEN job.error_message
            ELSE 'The extension stopped heartbeating before the crawl finished.'
          END,
          completed_at = CASE
            WHEN job.cancel_requested THEN now()
            ELSE NULL
          END,
          progress = jsonb_set(
            job.progress,
            '{stage}',
            to_jsonb(
              CASE
                WHEN job.cancel_requested THEN 'cancelled'::text
                ELSE 'interrupted'::text
              END
            )
          ),
          updated_at = now()
      FROM expired_slots
      WHERE job.id = expired_slots.job_id
        AND job.status IN ('running', 'processing_ai')
      RETURNING job.id, job.status
    `,
    [deviceId],
  );

  for (const job of expired.rows) {
    await transaction.query(
      `
        UPDATE crawl_tasks
        SET state = CASE WHEN $2 = 'cancelled' THEN 'skipped' ELSE 'pending' END,
            completed_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE NULL END,
            updated_at = now()
        WHERE job_id = $1
          AND state IN ('pending', 'running')
      `,
      [job.id, job.status],
    );
    await appendJobEvent(
      transaction,
      job.id,
      "warn",
      job.status === "cancelled" ? "job.cancelled" : "lease.expired",
      {},
    );
  }
}

export function registerExtensionRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  app.post("/api/v1/extension/pairing-codes", async (request, reply) => {
    parseWith(createPairingCodeSchema, request.body ?? {});
    const code = randomPairingCode();
    const result = await context.database.query<{ expires_at: Date }>(
      `
        INSERT INTO extension_pairing_codes (
          workspace_id, code_hash, expires_at
        )
        VALUES ($1, $2, now() + interval '5 minutes')
        RETURNING expires_at
      `,
      [context.config.workspaceId, hashSecret(code)],
    );
    return reply.code(201).send({
      code,
      expiresAt: toIso(result.rows[0]!.expires_at),
    });
  });

  app.post("/api/v1/extension/pair", async (request, reply) => {
    const input = parseWith(pairExtensionSchema, request.body);
    const pairing = await inTransaction(
      context.database,
      async (transaction) => {
        const codeResult = await transaction.query<{ id: string }>(
          `
            SELECT id
            FROM extension_pairing_codes
            WHERE code_hash = $1
              AND used_at IS NULL
              AND expires_at > now()
            FOR UPDATE
          `,
          [hashSecret(input.code)],
        );
        const code = codeResult.rows[0];
        if (!code) {
          throw new ApiError(
            400,
            "INVALID_PAIRING_CODE",
            "Pairing code is invalid, expired, or already used",
          );
        }
        const deviceToken = randomOpaqueToken();
        const deviceResult = await transaction.query<{ id: string }>(
          `
            INSERT INTO extension_devices (
              workspace_id,
              installation_id,
              token_hash,
              extension_version,
              runtime_status,
              last_seen_at
            )
            VALUES ($1, $2, $3, $4, 'online', now())
            ON CONFLICT (workspace_id, installation_id)
            DO UPDATE SET
              token_hash = EXCLUDED.token_hash,
              extension_version = EXCLUDED.extension_version,
              runtime_status = 'online',
              last_seen_at = now(),
              paired_at = now(),
              revoked_at = NULL,
              updated_at = now()
            RETURNING id
          `,
          [
            context.config.workspaceId,
            input.installationId,
            hashSecret(deviceToken),
            input.extensionVersion,
          ],
        );
        await transaction.query(
          "UPDATE extension_pairing_codes SET used_at = now() WHERE id = $1",
          [code.id],
        );
        return {
          deviceId: deviceResult.rows[0]!.id,
          deviceToken,
          workspaceId: context.config.workspaceId,
        };
      },
    );
    return reply.code(201).send(pairing);
  });

  app.delete("/api/v1/extension/devices/:id", async (request, reply) => {
    const { id } = parseWith(deviceParamsSchema, request.params);
    await inTransaction(context.database, async (transaction) => {
      const result = await transaction.query(
        `
          UPDATE extension_devices
          SET revoked_at = now(),
              runtime_status = 'offline',
              current_job_id = NULL,
              updated_at = now()
          WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL
        `,
        [id, context.config.workspaceId],
      );
      if (!result.rowCount) {
        return notFound("Extension device not found");
      }
      await transaction.query(
        "DELETE FROM crawler_slots WHERE extension_device_id = $1",
        [id],
      );
    });
    return reply.code(204).send();
  });

  app.get("/api/v1/extension/status", async () => {
    const result = await context.database.query<{
      id: string;
      extension_version: string;
      runtime_status: string;
      current_job_id: string | null;
      last_seen_at: Date | null;
      revoked_at: Date | null;
      is_online: boolean;
    }>(
      `
        SELECT id,
               extension_version,
               runtime_status,
               current_job_id,
               last_seen_at,
               revoked_at,
               (
                 revoked_at IS NULL
                 AND last_seen_at >= now() - ($2 * interval '1 second')
               ) AS is_online
        FROM extension_devices
        WHERE workspace_id = $1
        ORDER BY paired_at DESC
      `,
      [context.config.workspaceId, context.config.deviceOnlineSeconds],
    );
    return {
      items: result.rows.map((device) => ({
        id: device.id,
        extensionVersion: device.extension_version,
        status: device.is_online ? device.runtime_status : "offline",
        currentJobId: device.current_job_id,
        lastSeenAt: toIso(device.last_seen_at),
        revoked: device.revoked_at !== null,
      })),
    };
  });

  app.post("/api/v1/extension/heartbeat", async (request) => {
    const heartbeat = parseWith(extensionHeartbeatSchema, request.body);
    return inTransaction(context.database, async (transaction) => {
      const device = await authenticateDevice(
        transaction,
        request,
        heartbeat.deviceId,
      );
      let leaseExpiresAt: Date | undefined;
      let cancelRequested = false;

      if (!heartbeat.jobId) {
        await reconcileExpiredDeviceLeases(transaction, device.id);
      }

      if (
        heartbeat.jobId &&
        heartbeat.leaseToken &&
        heartbeat.fencingToken
      ) {
        await assertActiveLease(transaction, {
          deviceId: device.id,
          jobId: heartbeat.jobId,
          leaseToken: heartbeat.leaseToken,
          fencingToken: heartbeat.fencingToken,
        });
        const leaseResult = await transaction.query<{
          lease_expires_at: Date;
        }>(
          `
            UPDATE crawler_slots
            SET lease_expires_at = now() + ($5 * interval '1 second'),
                last_heartbeat_at = now(),
                updated_at = now()
            WHERE extension_device_id = $1
              AND platform = 'facebook'
              AND job_id = $2
              AND fencing_token = $3
              AND lease_token_hash = $4
            RETURNING lease_expires_at
          `,
          [
            device.id,
            heartbeat.jobId,
            heartbeat.fencingToken,
            hashSecret(heartbeat.leaseToken),
            context.config.leaseTtlSeconds,
          ],
        );
        leaseExpiresAt = leaseResult.rows[0]?.lease_expires_at;
        const jobResult = await transaction.query<{
          cancel_requested: boolean;
        }>(
          `
            UPDATE crawl_jobs
            SET progress = jsonb_set(
                  jsonb_set(progress, '{lastHeartbeatAt}', to_jsonb(now()::text)),
                  '{stage}',
                  to_jsonb('running'::text)
                ),
                updated_at = now()
            WHERE id = $1
            RETURNING cancel_requested
          `,
          [heartbeat.jobId],
        );
        cancelRequested = jobResult.rows[0]?.cancel_requested ?? false;
      }

      await transaction.query(
        `
          UPDATE extension_devices
          SET extension_version = $3,
              runtime_status = $4,
              current_job_id = $5,
              last_seen_at = now(),
              updated_at = now()
          WHERE id = $1 AND workspace_id = $2
        `,
        [
          device.id,
          device.workspaceId,
          heartbeat.extensionVersion,
          heartbeat.status,
          heartbeat.jobId ?? null,
        ],
      );

      const available = await transaction.query<{ id: string }>(
        `
          SELECT id
          FROM crawl_jobs
          WHERE workspace_id = $1
            AND extension_device_id = $2
            AND status IN ('waiting_extension', 'interrupted')
            AND cancel_requested = false
          ORDER BY created_at
          LIMIT 1
        `,
        [device.workspaceId, device.id],
      );
      const response: {
        serverTime: string;
        leaseExpiresAt?: string;
        cancelRequested: boolean;
        availableJobId?: string;
      } = {
        serverTime: new Date().toISOString(),
        cancelRequested,
      };
      if (leaseExpiresAt) {
        response.leaseExpiresAt = leaseExpiresAt.toISOString();
      }
      if (available.rows[0]) {
        response.availableJobId = available.rows[0].id;
      }
      return response;
    });
  });

  app.post("/api/v1/extension/jobs/:id/claim", async (request) => {
    const { id: jobId } = parseWith(jobParamsSchema, request.params);
    const claim = parseWith(claimJobSchema, request.body);
    return inTransaction(context.database, async (transaction) => {
      const device = await authenticateDevice(transaction, request, claim.deviceId);
      const jobResult = await transaction.query<{
        id: string;
        platform: "facebook" | "threads";
        extension_device_id: string | null;
        status: string;
        cancel_requested: boolean;
        settings_snapshot: Record<string, unknown>;
      }>(
        `
          SELECT id,
                 platform,
                 extension_device_id,
                 status,
                 cancel_requested,
                 settings_snapshot
          FROM crawl_jobs
          WHERE id = $1
            AND workspace_id = $2
            AND platform IN ('facebook', 'threads')
          FOR UPDATE
        `,
        [jobId, device.workspaceId],
      );
      const job = jobResult.rows[0];
      if (!job) {
        return notFound("Job not found");
      }
      if (job.extension_device_id !== device.id) {
        throw new ApiError(
          403,
          "JOB_ASSIGNED_TO_ANOTHER_DEVICE",
          "The job is assigned to another extension device",
        );
      }
      if (job.cancel_requested) {
        conflict("JOB_CANCELLED", "The job has a pending cancellation request");
      }
      if (!["waiting_extension", "interrupted", "running"].includes(job.status)) {
        conflict(
          "JOB_NOT_CLAIMABLE",
          `A job in status ${job.status} cannot be claimed`,
        );
      }

      const leaseToken = randomOpaqueToken();
      const slotResult = await transaction.query<{
        fencing_token: string;
        lease_expires_at: Date;
      }>(
        `
          INSERT INTO crawler_slots (
            extension_device_id,
            platform,
            job_id,
            lease_token_hash,
            fencing_token,
            lease_expires_at,
            last_heartbeat_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            1,
            now() + ($5 * interval '1 second'),
            now()
          )
          ON CONFLICT (extension_device_id, platform)
          DO UPDATE SET
            job_id = EXCLUDED.job_id,
            lease_token_hash = EXCLUDED.lease_token_hash,
            fencing_token = crawler_slots.fencing_token + 1,
            lease_expires_at = EXCLUDED.lease_expires_at,
            last_heartbeat_at = now(),
            updated_at = now()
          WHERE crawler_slots.lease_expires_at <= now()
             OR crawler_slots.job_id = EXCLUDED.job_id
          RETURNING fencing_token, lease_expires_at
        `,
        [
          device.id,
          job.platform,
          jobId,
          hashSecret(leaseToken),
          context.config.leaseTtlSeconds,
        ],
      );
      const slot = slotResult.rows[0];
      if (!slot) {
        conflict(
          "PLATFORM_SLOT_BUSY",
          "The device already has another active web crawl lease",
        );
      }
      await transaction.query(
        `
          UPDATE crawl_jobs
          SET status = 'running',
              started_at = COALESCE(started_at, now()),
              progress = jsonb_set(progress, '{stage}', to_jsonb('running'::text)),
              updated_at = now()
          WHERE id = $1
        `,
        [jobId],
      );
      await transaction.query(
        `
          UPDATE extension_devices
          SET current_job_id = $2,
              runtime_status = 'running',
              extension_version = $3,
              last_seen_at = now(),
              updated_at = now()
          WHERE id = $1
        `,
        [device.id, jobId, claim.extensionVersion],
      );
      const tasksResult = await transaction.query<{
        id: string;
        source_id: string | null;
        keyword_id: string | null;
        state: string;
        checkpoint: Record<string, unknown>;
      }>(
        `
          SELECT id, source_id, keyword_id, state, checkpoint
          FROM crawl_tasks
          WHERE job_id = $1
          ORDER BY created_at
        `,
        [jobId],
      );
      await appendJobEvent(
        transaction,
        jobId,
        "info",
        "extension.claimed",
        { deviceId: device.id, fencingToken: Number(slot.fencing_token) },
      );
      return {
        jobId,
        leaseToken,
        fencingToken: Number(slot.fencing_token),
        leaseExpiresAt: slot.lease_expires_at.toISOString(),
        snapshot: {
          ...job.settings_snapshot,
          tasks: tasksResult.rows.map((task) => ({
            id: task.id,
            sourceId: task.source_id,
            keywordId: task.keyword_id,
            state: task.state,
            checkpoint: task.checkpoint,
          })),
        },
      };
    });
  });

  app.post("/api/v1/extension/jobs/:id/batches", async (request) => {
    const { id: jobId } = parseWith(jobParamsSchema, request.params);
    const batch = parseWith(ingestBatchSchema, request.body);
    const idempotencyKey = idempotencyKeyFrom(request.headers);
    return inTransaction(context.database, async (transaction) => {
      const device = await authenticateDevice(transaction, request, batch.deviceId);
      await assertActiveLease(transaction, {
        deviceId: device.id,
        jobId,
        leaseToken: batch.leaseToken,
        fencingToken: batch.fencingToken,
      });
      const jobTypeResult = await transaction.query<{ type: string }>(
        `
          SELECT type
          FROM crawl_jobs
          WHERE id = $1 AND workspace_id = $2
        `,
        [jobId, device.workspaceId],
      );
      const expectedJobType =
        batch.kind === "sources" ? "discover_sources" : "crawl_content";
      if (jobTypeResult.rows[0]?.type !== expectedJobType) {
        throw new ApiError(
          400,
          "BATCH_KIND_JOB_MISMATCH",
          `${batch.kind} batches are only accepted by ${expectedJobType} jobs`,
        );
      }
      if (batch.kind === "content") {
        const taskResult = await transaction.query(
          `
            SELECT 1
            FROM crawl_tasks
            WHERE id = $1
              AND job_id = $2
              AND source_id IS NOT NULL
              AND keyword_id IS NOT NULL
          `,
          [batch.taskId, jobId],
        );
        if (!taskResult.rowCount) {
          throw new ApiError(
            400,
            "INVALID_CONTENT_TASK",
            "Content batch taskId does not belong to this crawl job",
          );
        }
      }

      const existingResult = await transaction.query<{
        checksum: string;
        state: string;
        response: {
          duplicate: boolean;
          accepted: { sources: number; posts: number; comments: number };
        } | null;
      }>(
        `
          SELECT checksum, state, response
          FROM ingest_batches
          WHERE job_id = $1 AND idempotency_key = $2
          FOR UPDATE
        `,
        [jobId, idempotencyKey],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (existing.checksum !== batch.checksum) {
          conflict(
            "IDEMPOTENCY_CHECKSUM_MISMATCH",
            "This idempotency key was already used with another payload",
          );
        }
        if (existing.state !== "completed" || !existing.response) {
          conflict(
            "BATCH_ALREADY_PROCESSING",
            "The batch is already being processed; retry later",
          );
        }
        return { ...existing.response, duplicate: true };
      }

      await transaction.query(
        `
          INSERT INTO ingest_batches (
            job_id, idempotency_key, checksum, kind, state
          )
          VALUES ($1, $2, $3, $4, 'processing')
        `,
        [jobId, idempotencyKey, batch.checksum, batch.kind],
      );

      const accepted =
        batch.kind === "sources"
          ? await ingestSourceBatch(transaction, device.workspaceId, batch)
          : await ingestContentBatch(
              transaction,
              device.workspaceId,
              jobId,
              batch,
            );
      if (batch.taskId) {
        const taskResult = await transaction.query(
          `
            UPDATE crawl_tasks
            SET state = 'running',
                checkpoint = COALESCE($3::jsonb, checkpoint),
                started_at = COALESCE(started_at, now()),
                updated_at = now()
            WHERE id = $1 AND job_id = $2
          `,
          [
            batch.taskId,
            jobId,
            batch.checkpoint ? JSON.stringify(batch.checkpoint) : null,
          ],
        );
        if (!taskResult.rowCount) {
          throw new ApiError(
            400,
            "INVALID_TASK",
            "Batch taskId does not belong to this job",
          );
        }
      }

      const countsResult = await transaction.query<{
        posts_saved: string;
        comments_saved: string;
        sentiment_total: string;
      }>(
        `
          SELECT
            (
              SELECT count(*)::text
              FROM posts
              WHERE last_seen_job_id = $1
            ) AS posts_saved,
            (
              SELECT count(*)::text
              FROM comments
              WHERE last_seen_job_id = $1
            ) AS comments_saved,
            (
              SELECT count(*)::text
              FROM sentiment_queue
              WHERE job_id = $1
            ) AS sentiment_total
        `,
        [jobId],
      );
      const counts = countsResult.rows[0]!;
      await transaction.query(
        `
          UPDATE crawl_jobs
          SET progress = jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(progress, '{stage}', to_jsonb('uploading'::text)),
                    '{postsSaved}',
                    to_jsonb($2::integer)
                  ),
                  '{commentsSaved}',
                  to_jsonb($3::integer)
                ),
                '{sentimentTotal}',
                to_jsonb($4::integer)
              ),
              updated_at = now()
          WHERE id = $1
        `,
        [
          jobId,
          Number(counts.posts_saved),
          Number(counts.comments_saved),
          Number(counts.sentiment_total),
        ],
      );
      const response = { duplicate: false, accepted };
      await transaction.query(
        `
          UPDATE ingest_batches
          SET state = 'completed',
              received_count = $3,
              response = $4::jsonb,
              completed_at = now()
          WHERE job_id = $1 AND idempotency_key = $2
        `,
        [
          jobId,
          idempotencyKey,
          accepted.sources + accepted.posts + accepted.comments,
          JSON.stringify(response),
        ],
      );
      await appendJobEvent(
        transaction,
        jobId,
        "info",
        "batch.accepted",
        { kind: batch.kind, ...accepted },
      );
      return response;
    });
  });

  app.post("/api/v1/extension/jobs/:id/events", async (request) => {
    const { id: jobId } = parseWith(jobParamsSchema, request.params);
    const event = parseWith(extensionEventSchema, request.body);
    assertNoIdentityTrackingFields(event.payload, "event.payload");
    if (event.progress) {
      assertNoIdentityTrackingFields(event.progress, "event.progress");
    }
    return inTransaction(context.database, async (transaction) => {
      const device = await authenticateDevice(transaction, request, event.deviceId);
      await assertActiveLease(transaction, {
        deviceId: device.id,
        jobId,
        leaseToken: event.leaseToken,
        fencingToken: event.fencingToken,
      });
      if (event.taskId) {
        const task = await transaction.query(
          `
            UPDATE crawl_tasks
            SET state = CASE
                  WHEN $3 = 'task.completed' THEN 'completed'
                  WHEN $3 = 'task.failed' THEN 'failed'
                  ELSE state
                END,
                completed_at = CASE
                  WHEN $3 IN ('task.completed', 'task.failed') THEN now()
                  ELSE completed_at
                END,
                updated_at = now()
            WHERE id = $1 AND job_id = $2
          `,
          [event.taskId, jobId, event.type],
        );
        if (!task.rowCount) {
          throw new ApiError(
            400,
            "INVALID_TASK",
            "Event taskId does not belong to this job",
          );
        }
      }
      if (event.progress) {
        await transaction.query(
          `
            UPDATE crawl_jobs
            SET progress = progress || $2::jsonb, updated_at = now()
            WHERE id = $1
          `,
          [jobId, JSON.stringify(event.progress)],
        );
      }
      if (event.type === "task.completed") {
        await transaction.query(
          `
            UPDATE crawl_jobs AS job
            SET progress = jsonb_set(
                  jsonb_set(
                    job.progress,
                    '{tasksDone}',
                    to_jsonb((
                      SELECT count(*)::integer
                      FROM crawl_tasks
                      WHERE job_id = job.id AND state = 'completed'
                    ))
                  ),
                  '{sourcesDone}',
                  to_jsonb((
                    SELECT count(*)::integer
                    FROM (
                      SELECT source_id
                      FROM crawl_tasks
                      WHERE job_id = job.id AND source_id IS NOT NULL
                      GROUP BY source_id
                      HAVING bool_and(state = 'completed')
                    ) AS completed_sources
                  ))
                ),
                updated_at = now()
            WHERE job.id = $1
          `,
          [jobId],
        );
      }
      const sequence = await appendJobEvent(
        transaction,
        jobId,
        event.level,
        event.type,
        event.payload,
      );
      return { sequence };
    });
  });

  app.post("/api/v1/extension/jobs/:id/complete", async (request) => {
    const { id: jobId } = parseWith(jobParamsSchema, request.params);
    const completion = parseWith(completeJobSchema, request.body);
    return inTransaction(context.database, async (transaction) => {
      const device = await authenticateDevice(
        transaction,
        request,
        completion.deviceId,
      );
      await assertActiveLease(transaction, {
        deviceId: device.id,
        jobId,
        leaseToken: completion.leaseToken,
        fencingToken: completion.fencingToken,
      });
      const jobResult = await transaction.query<{
        type: "discover_sources" | "crawl_content";
      }>(
        "SELECT type FROM crawl_jobs WHERE id = $1 FOR UPDATE",
        [jobId],
      );
      const job = jobResult.rows[0];
      if (!job) {
        return notFound("Job not found");
      }
      const pendingResult = await transaction.query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM sentiment_queue
          WHERE job_id = $1
            AND status IN ('queued', 'processing', 'retry_wait')
        `,
        [jobId],
      );
      const hasPendingSentiment = Number(pendingResult.rows[0]?.count ?? 0) > 0;
      const finalCrawlStatus =
        completion.outcome === "partial" ? "partial" : "completed";
      const status =
        job.type === "crawl_content" && hasPendingSentiment
          ? "processing_ai"
          : finalCrawlStatus;
      if (completion.progress) {
        assertNoIdentityTrackingFields(completion.progress, "progress");
      }
      await transaction.query(
        `
          UPDATE crawl_jobs
          SET status = $2,
              crawl_outcome = $3,
              progress = CASE
                WHEN $4::jsonb IS NULL
                  THEN jsonb_set(progress, '{stage}', to_jsonb($2::text))
                ELSE jsonb_set($4::jsonb, '{stage}', to_jsonb($2::text))
              END,
              error_message = $5,
              completed_at = CASE
                WHEN $2 IN ('completed', 'partial') THEN now()
                ELSE NULL
              END,
              updated_at = now()
          WHERE id = $1
        `,
        [
          jobId,
          status,
          completion.outcome,
          completion.progress ? JSON.stringify(completion.progress) : null,
          completion.partialReason ?? null,
        ],
      );
      await transaction.query(
        `
          UPDATE crawl_tasks
          SET state = CASE WHEN state = 'failed' THEN state ELSE 'completed' END,
              completed_at = COALESCE(completed_at, now()),
              updated_at = now()
          WHERE job_id = $1
        `,
        [jobId],
      );
      await appendJobEvent(
        transaction,
        jobId,
        completion.outcome === "partial" ? "warn" : "info",
        "extension.completed",
        {
          outcome: completion.outcome,
          coverageStatus: completion.coverageStatus ?? "unknown",
          ...(completion.partialReason
            ? { partialReason: completion.partialReason }
            : {}),
        },
      );
      await transaction.query(
        "DELETE FROM crawler_slots WHERE extension_device_id = $1 AND job_id = $2",
        [device.id, jobId],
      );
      await transaction.query(
        `
          UPDATE extension_devices
          SET current_job_id = NULL,
              runtime_status = 'online',
              last_seen_at = now(),
              updated_at = now()
          WHERE id = $1
        `,
        [device.id],
      );
      return { id: jobId, status };
    });
  });

  app.post("/api/v1/extension/jobs/:id/fail", async (request) => {
    const { id: jobId } = parseWith(jobParamsSchema, request.params);
    const failure = parseWith(failJobSchema, request.body);
    return inTransaction(context.database, async (transaction) => {
      const device = await authenticateDevice(
        transaction,
        request,
        failure.deviceId,
      );
      await assertActiveLease(transaction, {
        deviceId: device.id,
        jobId,
        leaseToken: failure.leaseToken,
        fencingToken: failure.fencingToken,
      });
      const failureResult = await transaction.query<{
        status: "failed" | "needs_login" | "interrupted" | "cancelled";
      }>(
        `
          UPDATE crawl_jobs
          SET status = CASE
                WHEN cancel_requested AND $2 = 'interrupted' THEN 'cancelled'
                ELSE $2
              END,
              error_code = $3,
              error_message = $4,
              progress = jsonb_set(
                progress,
                '{stage}',
                to_jsonb(
                  CASE
                    WHEN cancel_requested AND $2 = 'interrupted'
                      THEN 'cancelled'::text
                    ELSE $2::text
                  END
                )
              ),
              completed_at = CASE
                WHEN $2 = 'failed' OR (cancel_requested AND $2 = 'interrupted')
                  THEN now()
                ELSE NULL
              END,
              updated_at = now()
          WHERE id = $1
          RETURNING status
        `,
        [jobId, failure.status, failure.code, failure.message],
      );
      const finalStatus = failureResult.rows[0]?.status ?? failure.status;
      await appendJobEvent(
        transaction,
        jobId,
        "error",
        "extension.failed",
        {
          status: finalStatus,
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        },
      );
      await transaction.query(
        "DELETE FROM crawler_slots WHERE extension_device_id = $1 AND job_id = $2",
        [device.id, jobId],
      );
      await transaction.query(
        `
          UPDATE extension_devices
          SET current_job_id = NULL,
              runtime_status = CASE
                WHEN $2 = 'needs_login' THEN 'needs_login'
                ELSE 'online'
              END,
              last_seen_at = now(),
              updated_at = now()
          WHERE id = $1
        `,
        [device.id, finalStatus],
      );
      return { id: jobId, status: finalStatus };
    });
  });
}
