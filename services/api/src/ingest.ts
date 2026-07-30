import {
  idSchema,
  type contentBatchSchema,
  type sourceBatchSchema,
} from "@listening-social/contracts";
import type { z } from "zod";
import type { Transaction } from "./db.js";
import { ApiError } from "./errors.js";
import { calculateChecksum } from "./idempotency.js";
import { keywordMatches } from "./keywords.js";
import {
  assertNoIdentityTrackingFields,
  authorForStorage,
  sanitizeFacebookContentUrl,
  sanitizeFacebookGroupUrl,
} from "./privacy.js";

type SourceBatch = z.infer<typeof sourceBatchSchema>;
type ContentBatch = z.infer<typeof contentBatchSchema>;

export interface AcceptedCounts {
  sources: number;
  posts: number;
  comments: number;
}

interface TrustedKeyword {
  id: string;
  value: string;
  matchMode: "whole_word" | "contains_phrase";
}

interface TrustedJobScope {
  sourceId: string;
  taskKeywordId: string;
  keywords: TrustedKeyword[];
  windowStart: number;
  windowEnd: number;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function trustedJobScope(
  transaction: Transaction,
  workspaceId: string,
  jobId: string,
  taskId: string,
): Promise<TrustedJobScope> {
  const jobResult = await transaction.query<{
    settings_snapshot: unknown;
    task_source_id: string | null;
    task_keyword_id: string | null;
  }>(
    `
      SELECT job.settings_snapshot,
             task.source_id AS task_source_id,
             task.keyword_id AS task_keyword_id
      FROM crawl_jobs AS job
      JOIN crawl_tasks AS task
        ON task.job_id = job.id
       AND task.id = $3
      WHERE job.id = $2
        AND job.workspace_id = $1
        AND job.type = 'crawl_content'
        AND job.platform = 'facebook'
    `,
    [workspaceId, jobId, taskId],
  );
  const job = jobResult.rows[0];
  if (!job?.task_source_id || !job.task_keyword_id) {
    throw new ApiError(
      400,
      "INVALID_CONTENT_TASK",
      "Content batch taskId must identify a Facebook crawl task in this job",
    );
  }

  const snapshot = objectValue(job.settings_snapshot);
  const rawSourceIds = snapshot?.["sourceIds"];
  const sourceIds = Array.isArray(rawSourceIds)
    ? new Set(
        rawSourceIds.filter(
          (value): value is string =>
            typeof value === "string" && idSchema.safeParse(value).success,
        ),
      )
    : new Set<string>();
  const rawKeywords = snapshot?.["keywords"];
  const snapshotKeywords = new Map<string, TrustedKeyword>();
  if (Array.isArray(rawKeywords)) {
    for (const rawKeyword of rawKeywords) {
      const keyword = objectValue(rawKeyword);
      const id = keyword?.["id"];
      const value = keyword?.["value"];
      const matchMode = keyword?.["matchMode"];
      if (
        typeof id === "string" &&
        idSchema.safeParse(id).success &&
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 200 &&
        (matchMode === "whole_word" || matchMode === "contains_phrase")
      ) {
        snapshotKeywords.set(id, { id, value, matchMode });
      }
    }
  }
  const windowStart = Date.parse(String(snapshot?.["windowStartUtc"] ?? ""));
  const windowEnd = Date.parse(String(snapshot?.["windowEndUtc"] ?? ""));
  if (
    !sourceIds.has(job.task_source_id) ||
    !snapshotKeywords.has(job.task_keyword_id) ||
    !Number.isFinite(windowStart) ||
    !Number.isFinite(windowEnd) ||
    windowStart > windowEnd
  ) {
    throw new ApiError(
      400,
      "INVALID_JOB_SCOPE",
      "The crawl task is not represented by a valid frozen job snapshot",
    );
  }

  const keywordIds = [...snapshotKeywords.keys()];
  const allowedResult = await transaction.query<{ id: string }>(
    `
      SELECT keyword.id
      FROM keywords AS keyword
      WHERE keyword.workspace_id = $1
        AND keyword.platform = 'facebook'
        AND keyword.id = ANY($2::uuid[])
    `,
    [workspaceId, keywordIds],
  );
  const allowedIds = new Set(allowedResult.rows.map((keyword) => keyword.id));
  const keywords = [...snapshotKeywords.values()].filter((keyword) =>
    allowedIds.has(keyword.id),
  );
  if (!keywords.some((keyword) => keyword.id === job.task_keyword_id)) {
    throw new ApiError(
      400,
      "INVALID_JOB_KEYWORD",
      "The task keyword no longer belongs to this Facebook workspace",
    );
  }
  return {
    sourceId: job.task_source_id,
    taskKeywordId: job.task_keyword_id,
    keywords,
    windowStart,
    windowEnd,
  };
}

async function sourceIdForPost(
  transaction: Transaction,
  workspaceId: string,
  post: ContentBatch["posts"][number],
  expectedSourceId: string,
): Promise<string> {
  const result = post.sourceId
    ? await transaction.query<{ id: string }>(
        `
          SELECT id
          FROM sources
          WHERE id = $1 AND workspace_id = $2 AND platform = 'facebook'
        `,
        [post.sourceId, workspaceId],
      )
    : await transaction.query<{ id: string }>(
        `
          SELECT id
          FROM sources
          WHERE workspace_id = $1
            AND platform = 'facebook'
            AND external_id = $2
        `,
        [workspaceId, post.sourceExternalId],
      );
  const source = result.rows[0];
  if (!source) {
    throw new ApiError(
      400,
      "UNKNOWN_POST_SOURCE",
      `Source for post ${post.externalId} was not discovered`,
    );
  }
  if (source.id !== expectedSourceId) {
    throw new ApiError(
      400,
      "POST_SOURCE_OUT_OF_SCOPE",
      `Source for post ${post.externalId} is outside this crawl task`,
    );
  }
  return source.id;
}

function assertPostTimeInScope(
  post: ContentBatch["posts"][number],
  scope: TrustedJobScope,
): void {
  if (post.timeParseStatus === "unknown") {
    if (post.publishedAt !== null) {
      throw new ApiError(
        400,
        "POST_TIME_STATUS_MISMATCH",
        `Post ${post.externalId} has a timestamp but marks it as unknown`,
      );
    }
    return;
  }
  const publishedAt = post.publishedAt ? Date.parse(post.publishedAt) : Number.NaN;
  if (
    !Number.isFinite(publishedAt) ||
    publishedAt < scope.windowStart ||
    publishedAt > scope.windowEnd
  ) {
    throw new ApiError(
      400,
      "POST_TIME_OUT_OF_SCOPE",
      `Published time for post ${post.externalId} is outside this crawl job`,
    );
  }
}

async function queueSentiment(
  transaction: Transaction,
  input: {
    workspaceId: string;
    jobId: string;
    entityId: string;
    text: string;
    postContext: string | null;
  },
): Promise<void> {
  await transaction.query(
    `
      INSERT INTO sentiment_queue (
        workspace_id,
        job_id,
        entity_type,
        entity_id,
        text,
        post_context,
        status,
        available_at
      )
      VALUES ($1, $2, 'comment', $3, $4, $5, 'queued', now())
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        job_id = EXCLUDED.job_id,
        text = EXCLUDED.text,
        post_context = EXCLUDED.post_context,
        status = 'queued',
        attempt_count = 0,
        available_at = now(),
        locked_at = NULL,
        completed_at = NULL,
        last_error = NULL,
        updated_at = now()
    `,
    [
      input.workspaceId,
      input.jobId,
      input.entityId,
      input.text,
      input.postContext,
    ],
  );
}

async function requeuePostComments(
  transaction: Transaction,
  input: {
    workspaceId: string;
    jobId: string;
    postId: string;
    postContext: string;
  },
): Promise<void> {
  await transaction.query(
    `
      INSERT INTO sentiment_queue (
        workspace_id,
        job_id,
        entity_type,
        entity_id,
        text,
        post_context,
        status,
        available_at
      )
      SELECT comment.workspace_id,
             $2,
             'comment',
             comment.id,
             comment.body,
             $4,
             'queued',
             now()
      FROM comments AS comment
      WHERE comment.workspace_id = $1
        AND comment.post_id = $3
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        job_id = EXCLUDED.job_id,
        text = EXCLUDED.text,
        post_context = EXCLUDED.post_context,
        status = 'queued',
        attempt_count = 0,
        available_at = now(),
        locked_at = NULL,
        completed_at = NULL,
        last_error = NULL,
        updated_at = now()
    `,
    [
      input.workspaceId,
      input.jobId,
      input.postId,
      input.postContext.slice(0, 2_000),
    ],
  );
}

export async function ingestSourceBatch(
  transaction: Transaction,
  workspaceId: string,
  batch: SourceBatch,
): Promise<AcceptedCounts> {
  if (batch.checkpoint) {
    assertNoIdentityTrackingFields(batch.checkpoint, "checkpoint");
  }
  for (const source of batch.sources) {
    const canonicalUrl = sanitizeFacebookGroupUrl(source.canonicalUrl);
    const externalId =
      source.externalId ?? `url:${calculateChecksum(canonicalUrl)}`;
    await transaction.query(
      `
        INSERT INTO sources (
          workspace_id,
          platform,
          external_id,
          name,
          canonical_url,
          active,
          last_discovered_at
        )
        VALUES ($1, 'facebook', $2, $3, $4, true, now())
        ON CONFLICT (workspace_id, platform, external_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          canonical_url = EXCLUDED.canonical_url,
          active = true,
          last_discovered_at = now(),
          updated_at = now()
      `,
      [workspaceId, externalId, source.name, canonicalUrl],
    );
  }
  return { sources: batch.sources.length, posts: 0, comments: 0 };
}

export async function ingestContentBatch(
  transaction: Transaction,
  workspaceId: string,
  jobId: string,
  batch: ContentBatch,
): Promise<AcceptedCounts> {
  if (batch.checkpoint) {
    assertNoIdentityTrackingFields(batch.checkpoint, "checkpoint");
  }

  // Extension-provided matchedKeywordIds are hints only. The API independently
  // derives hits from the immutable keywords captured by the crawl job.
  const scope = await trustedJobScope(
    transaction,
    workspaceId,
    jobId,
    batch.taskId,
  );
  const postIds = new Map<string, { id: string; body: string }>();
  for (const post of batch.posts) {
    const matchedKeywords = scope.keywords.filter((keyword) =>
      keywordMatches(post.body, keyword),
    );
    if (matchedKeywords.length === 0) {
      throw new ApiError(
        400,
        "POST_KEYWORD_MISMATCH",
        `Post ${post.externalId} does not match a trusted job keyword`,
      );
    }
    if (
      !matchedKeywords.some((keyword) => keyword.id === scope.taskKeywordId)
    ) {
      throw new ApiError(
        400,
        "POST_TASK_KEYWORD_MISMATCH",
        `Post ${post.externalId} does not match this crawl task keyword`,
      );
    }
    const sourceId = await sourceIdForPost(
      transaction,
      workspaceId,
      post,
      scope.sourceId,
    );
    assertPostTimeInScope(post, scope);
    const author = authorForStorage(post.author);
    const canonicalUrl = sanitizeFacebookContentUrl(post.url);
    if (!canonicalUrl) {
      throw new Error("Post URL is required");
    }
    const contentHash = calculateChecksum({
      body: post.body,
      publishedAt: post.publishedAt,
      author,
    });
    const previous = await transaction.query<{ id: string; body: string }>(
      `
        SELECT id, body
        FROM posts
        WHERE workspace_id = $1
          AND platform = 'facebook'
          AND external_id = $2
        FOR UPDATE
      `,
      [workspaceId, post.externalId],
    );
    const result = await transaction.query<{ id: string }>(
      `
        INSERT INTO posts (
          workspace_id,
          source_id,
          first_seen_job_id,
          last_seen_job_id,
          platform,
          external_id,
          canonical_url,
          body,
          published_at,
          collected_at,
          time_parse_status,
          author_name,
          is_anonymous,
          author_kind,
          content_hash
        )
        VALUES (
          $1, $2, $3, $3, 'facebook', $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13
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
          author_name = EXCLUDED.author_name,
          is_anonymous = EXCLUDED.is_anonymous,
          author_kind = EXCLUDED.author_kind,
          content_hash = EXCLUDED.content_hash,
          updated_at = now()
        RETURNING id
      `,
      [
        workspaceId,
        sourceId,
        jobId,
        post.externalId,
        canonicalUrl,
        post.body,
        post.publishedAt,
        post.collectedAt,
        post.timeParseStatus,
        author.authorName,
        author.isAnonymous,
        author.authorKind,
        contentHash,
      ],
    );
    const postId = result.rows[0]!.id;
    postIds.set(post.externalId, { id: postId, body: post.body });

    await transaction.query(
      `
        DELETE FROM keyword_hits
        WHERE entity_type = 'post' AND entity_id = $1
      `,
      [postId],
    );
    for (const keyword of matchedKeywords) {
      await transaction.query(
        `
          INSERT INTO keyword_hits (
            keyword_id,
            entity_type,
            entity_id,
            matched_keyword_value,
            matched_match_mode,
            match_excerpt
          )
          VALUES ($1, 'post', $2, $3, $4, $5)
          ON CONFLICT (keyword_id, entity_type, entity_id)
          DO UPDATE SET
            matched_keyword_value = EXCLUDED.matched_keyword_value,
            matched_match_mode = EXCLUDED.matched_match_mode,
            match_excerpt = EXCLUDED.match_excerpt
        `,
        [
          keyword.id,
          postId,
          keyword.value,
          keyword.matchMode,
          post.body.slice(0, 1_000),
        ],
      );
    }
    if (
      previous.rows[0] &&
      previous.rows[0].body !== post.body
    ) {
      await requeuePostComments(transaction, {
        workspaceId,
        jobId,
        postId,
        postContext: post.body,
      });
    }
  }

  const insertedComments = new Map<
    string,
    {
      id: string;
      parentExternalId: string | null;
      postId: string;
    }
  >();
  for (const comment of batch.comments) {
    let post = postIds.get(comment.postExternalId);
    if (!post) {
      const result = await transaction.query<{ id: string; body: string }>(
        `
          SELECT id, body
          FROM posts
          WHERE workspace_id = $1
            AND platform = 'facebook'
            AND external_id = $2
            AND source_id = $3
            AND last_seen_job_id = $7
            AND (
              (time_parse_status = 'unknown' AND published_at IS NULL)
              OR (
                time_parse_status = 'parsed'
                AND published_at BETWEEN $5 AND $6
              )
            )
            AND EXISTS (
              SELECT 1
              FROM keyword_hits AS hit
              WHERE hit.entity_type = 'post'
                AND hit.entity_id = posts.id
                AND hit.keyword_id = $4
            )
        `,
        [
          workspaceId,
          comment.postExternalId,
          scope.sourceId,
          scope.taskKeywordId,
          new Date(scope.windowStart),
          new Date(scope.windowEnd),
          jobId,
        ],
      );
      post = result.rows[0];
    }
    if (!post) {
      throw new ApiError(
        400,
        "UNKNOWN_COMMENT_POST",
        `Parent post ${comment.postExternalId} is missing`,
      );
    }

    const author = authorForStorage(comment.author);
    const canonicalUrl = sanitizeFacebookContentUrl(comment.url);
    const contentHash = calculateChecksum({
      body: comment.body,
      publishedAt: comment.publishedAt,
      author,
    });
    const previous = await transaction.query<{
      id: string;
      content_hash: string;
    }>(
      `
        SELECT id, content_hash
        FROM comments
        WHERE workspace_id = $1
          AND platform = 'facebook'
          AND external_id = $2
        FOR UPDATE
      `,
      [workspaceId, comment.externalId],
    );
    const result = await transaction.query<{ id: string }>(
      `
        INSERT INTO comments (
          workspace_id,
          post_id,
          first_seen_job_id,
          last_seen_job_id,
          platform,
          external_id,
          canonical_url,
          body,
          published_at,
          collected_at,
          time_parse_status,
          author_name,
          is_anonymous,
          author_kind,
          content_hash
        )
        VALUES (
          $1, $2, $3, $3, 'facebook', $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13
        )
        ON CONFLICT (workspace_id, platform, external_id)
        DO UPDATE SET
          post_id = EXCLUDED.post_id,
          last_seen_job_id = EXCLUDED.last_seen_job_id,
          canonical_url = EXCLUDED.canonical_url,
          body = EXCLUDED.body,
          published_at = EXCLUDED.published_at,
          collected_at = EXCLUDED.collected_at,
          time_parse_status = EXCLUDED.time_parse_status,
          author_name = EXCLUDED.author_name,
          is_anonymous = EXCLUDED.is_anonymous,
          author_kind = EXCLUDED.author_kind,
          content_hash = EXCLUDED.content_hash,
          updated_at = now()
        RETURNING id
      `,
      [
        workspaceId,
        post.id,
        jobId,
        comment.externalId,
        canonicalUrl,
        comment.body,
        comment.publishedAt,
        comment.collectedAt,
        comment.timeParseStatus,
        author.authorName,
        author.isAnonymous,
        author.authorKind,
        contentHash,
      ],
    );
    const commentId = result.rows[0]!.id;
    insertedComments.set(comment.externalId, {
      id: commentId,
      parentExternalId: comment.parentCommentExternalId ?? null,
      postId: post.id,
    });

    if (previous.rows[0]?.content_hash !== contentHash) {
      await queueSentiment(transaction, {
        workspaceId,
        jobId,
        entityId: commentId,
        text: comment.body,
        postContext: post.body.slice(0, 2_000),
      });
    }
  }

  for (const comment of insertedComments.values()) {
    if (!comment.parentExternalId) {
      continue;
    }
    const inBatchParent = insertedComments.get(comment.parentExternalId);
    if (inBatchParent && inBatchParent.postId !== comment.postId) {
      throw new ApiError(
        400,
        "PARENT_COMMENT_POST_MISMATCH",
        `Parent comment ${comment.parentExternalId} belongs to another post`,
      );
    }
    const parentResult = inBatchParent
      ? { rows: [{ id: inBatchParent.id }] }
      : await transaction.query<{ id: string }>(
          `
            SELECT id
            FROM comments
            WHERE workspace_id = $1
              AND platform = 'facebook'
              AND external_id = $2
              AND post_id = $3
          `,
          [workspaceId, comment.parentExternalId, comment.postId],
        );
    const parent = parentResult.rows[0];
    if (!parent) {
      throw new ApiError(
        400,
        "UNKNOWN_PARENT_COMMENT",
        `Parent comment ${comment.parentExternalId} is missing`,
      );
    }
    await transaction.query(
      "UPDATE comments SET parent_comment_id = $2 WHERE id = $1",
      [comment.id, parent.id],
    );
  }

  return {
    sources: 0,
    posts: batch.posts.length,
    comments: batch.comments.length,
  };
}
