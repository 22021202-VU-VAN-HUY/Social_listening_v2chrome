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
  facebookCommentExternalIdFromUrl,
  facebookPostExternalIdFromUrl,
  sanitizeFacebookContentUrl,
  sanitizeFacebookGroupUrl,
  sanitizeThreadsContentUrl,
  threadsPostExternalIdFromUrl,
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
  platform: "facebook" | "threads";
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
    platform: "facebook" | "threads";
    settings_snapshot: unknown;
    task_source_id: string | null;
    task_keyword_id: string | null;
  }>(
    `
      SELECT job.platform,
             job.settings_snapshot,
             task.source_id AS task_source_id,
             task.keyword_id AS task_keyword_id
      FROM crawl_jobs AS job
      JOIN crawl_tasks AS task
        ON task.job_id = job.id
       AND task.id = $3
      WHERE job.id = $2
        AND job.workspace_id = $1
        AND job.type = 'crawl_content'
        AND job.platform IN ('facebook', 'threads')
    `,
    [workspaceId, jobId, taskId],
  );
  const job = jobResult.rows[0];
  if (!job?.task_source_id || !job.task_keyword_id) {
    throw new ApiError(
      400,
      "INVALID_CONTENT_TASK",
      "Content batch taskId must identify a web crawl task in this job",
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
        AND keyword.platform = $3
        AND keyword.id = ANY($2::uuid[])
    `,
    [workspaceId, keywordIds, job.platform],
  );
  const allowedIds = new Set(allowedResult.rows.map((keyword) => keyword.id));
  const keywords = [...snapshotKeywords.values()].filter((keyword) =>
    allowedIds.has(keyword.id),
  );
  if (!keywords.some((keyword) => keyword.id === job.task_keyword_id)) {
    throw new ApiError(
      400,
      "INVALID_JOB_KEYWORD",
      `The task keyword no longer belongs to this ${job.platform} workspace`,
    );
  }
  return {
    platform: job.platform,
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
  platform: "facebook" | "threads",
): Promise<string> {
  const result = post.sourceId
    ? await transaction.query<{ id: string }>(
        `
          SELECT id
          FROM sources
          WHERE id = $1 AND workspace_id = $2 AND platform = $3
        `,
        [post.sourceId, workspaceId, platform],
      )
    : await transaction.query<{ id: string }>(
        `
          SELECT id
          FROM sources
          WHERE workspace_id = $1
            AND platform = $3
            AND external_id = $2
        `,
        [workspaceId, post.sourceExternalId, platform],
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
      scope.platform,
    );
    assertPostTimeInScope(post, scope);
    const author = authorForStorage(post.author);
    const canonicalUrl =
      scope.platform === "threads"
        ? sanitizeThreadsContentUrl(post.url)
        : sanitizeFacebookContentUrl(post.url);
    if (!canonicalUrl) {
      throw new Error("Post URL is required");
    }
    const urlExternalId =
      scope.platform === "threads"
        ? threadsPostExternalIdFromUrl(canonicalUrl)
        : facebookPostExternalIdFromUrl(canonicalUrl);
    if (urlExternalId !== post.externalId) {
      throw new ApiError(
        400,
        "POST_ID_URL_MISMATCH",
        `Post ${post.externalId} does not match its canonical ${scope.platform} URL`,
      );
    }
    const contentHash = calculateChecksum({
      body: post.body,
      publishedAt: post.publishedAt,
      author,
    });
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
          anonymous_avatar_variant,
          content_hash
        )
        VALUES (
          $1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15
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
          anonymous_avatar_variant = EXCLUDED.anonymous_avatar_variant,
          content_hash = EXCLUDED.content_hash,
          updated_at = now()
        RETURNING id
      `,
      [
        workspaceId,
        sourceId,
        jobId,
        scope.platform,
        post.externalId,
        canonicalUrl,
        post.body,
        post.publishedAt,
        post.collectedAt,
        post.timeParseStatus,
        author.authorName,
        author.isAnonymous,
        author.authorKind,
        author.anonymousAvatarVariant,
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
  }

  const insertedComments = new Map<
    string,
    {
      id: string;
      parentExternalId: string | null;
      postId: string;
    }
  >();
  for (const [commentIndex, comment] of batch.comments.entries()) {
    let post = postIds.get(comment.postExternalId);
    if (!post) {
      const result = await transaction.query<{ id: string; body: string }>(
        `
          SELECT id, body
          FROM posts
          WHERE workspace_id = $1
            AND platform = $8
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
          scope.platform,
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
    const canonicalUrl =
      scope.platform === "threads"
        ? sanitizeThreadsContentUrl(comment.url)
        : sanitizeFacebookContentUrl(comment.url);
    if (canonicalUrl) {
      const urlCommentExternalId =
        scope.platform === "threads"
          ? threadsPostExternalIdFromUrl(canonicalUrl)
          : facebookCommentExternalIdFromUrl(canonicalUrl);
      if (scope.platform === "facebook") {
        const urlPostExternalId = facebookPostExternalIdFromUrl(canonicalUrl);
        if (urlPostExternalId !== comment.postExternalId) {
          throw new ApiError(
            400,
            "COMMENT_POST_ID_URL_MISMATCH",
            `Comment ${comment.externalId} does not match its parent post URL`,
          );
        }
      }
      if (
        urlCommentExternalId &&
        urlCommentExternalId !== comment.externalId
      ) {
        throw new ApiError(
          400,
          "COMMENT_ID_URL_MISMATCH",
          `Comment ${comment.externalId} does not match its canonical ${scope.platform} URL`,
        );
      }
    }
    const contentHash = calculateChecksum({
      body: comment.body,
      publishedAt: comment.publishedAt,
      author,
    });
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
          anonymous_avatar_variant,
          observed_order,
          content_hash
        )
        VALUES (
          $1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16
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
          anonymous_avatar_variant = EXCLUDED.anonymous_avatar_variant,
          observed_order = EXCLUDED.observed_order,
          content_hash = EXCLUDED.content_hash,
          updated_at = now()
        RETURNING id
      `,
      [
        workspaceId,
        post.id,
        jobId,
        scope.platform,
        comment.externalId,
        canonicalUrl,
        comment.body,
        comment.publishedAt,
        comment.collectedAt,
        comment.timeParseStatus,
        author.authorName,
        author.isAnonymous,
        author.authorKind,
        author.anonymousAvatarVariant,
        comment.observedOrder ?? commentIndex,
        contentHash,
      ],
    );
    const commentId = result.rows[0]!.id;
    insertedComments.set(comment.externalId, {
      id: commentId,
      parentExternalId: comment.parentCommentExternalId ?? null,
      postId: post.id,
    });

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
              AND platform = $4
              AND external_id = $2
              AND post_id = $3
          `,
          [workspaceId, comment.parentExternalId, comment.postId, scope.platform],
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
