import {
  idSchema,
  listeningFilterSchema,
  sentimentOverrideSchema,
} from "@listening-social/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { notFound } from "../errors.js";
import { authorFromRow, toIso } from "../serialize.js";
import { parseWith } from "../validation.js";

const sentimentParamsSchema = z
  .object({
    entityType: z.enum(["post", "comment"]),
    entityId: idSchema,
  })
  .strict();

interface ContentRow {
  id: string;
  platform: "facebook" | "tiktok" | "threads";
  external_id: string;
  source_id: string;
  source_name: string;
  post_id?: string;
  post_external_id?: string;
  post_url?: string;
  post_body?: string;
  post_published_at?: Date | null;
  post_collected_at?: Date;
  post_time_parse_status?: "parsed" | "unknown";
  post_author_name?: string | null;
  post_is_anonymous?: boolean;
  post_author_kind?: "real" | "anonymous" | "unknown";
  post_anonymous_avatar_variant?: number | null;
  post_sentiment_label?: "positive" | "negative" | "neutral" | null;
  post_sentiment_confidence?: string | number | null;
  post_sentiment_relevant?: boolean | null;
  post_sentiment_needs_review?: boolean | null;
  matched_keywords?: Array<{
    id: string;
    value: string;
    matchMode: "whole_word" | "contains_phrase";
  }>;
  parent_comment_id?: string | null;
  observed_order?: number | null;
  canonical_url: string | null;
  body: string;
  published_at: Date | null;
  collected_at: Date;
  time_parse_status: "parsed" | "unknown";
  author_name: string | null;
  is_anonymous: boolean;
  author_kind: "real" | "anonymous" | "unknown";
  anonymous_avatar_variant?: number | null;
  sentiment_label: "positive" | "negative" | "neutral" | null;
  sentiment_confidence: string | number | null;
  sentiment_relevant: boolean | null;
  sentiment_needs_review: boolean | null;
}

function sentimentFromRow(row: ContentRow) {
  return row.sentiment_label
    ? {
        label: row.sentiment_label,
        confidence: Number(row.sentiment_confidence ?? 0),
        isRelevant: row.sentiment_relevant ?? true,
        needsReview: row.sentiment_needs_review ?? false,
      }
    : null;
}

function filterSql(
  query: ReturnType<typeof listeningFilterSchema.parse>,
  alias: "post" | "comment",
): { conditions: string[]; values: unknown[] } {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const add = (condition: (position: number) => string, value: unknown) => {
    values.push(value);
    conditions.push(condition(values.length));
  };
  if (query.platform) {
    add((position) => `${alias}.platform = $${position}`, query.platform);
  }
  if (query.from) {
    add((position) => `${alias}.published_at >= $${position}`, query.from);
  }
  if (query.to) {
    add((position) => `${alias}.published_at <= $${position}`, query.to);
  }
  if (query.includeUnknownTime !== "true") {
    conditions.push(`${alias}.time_parse_status = 'parsed'`);
  }
  return { conditions, values };
}

const latestSentimentSql = (
  entityType: "post" | "comment",
  entityAlias: string,
  analysisAlias = "analysis",
  overrideAlias = "override",
) => `
  LEFT JOIN LATERAL (
    SELECT label, confidence, is_relevant, needs_review
    FROM sentiment_analyses
    WHERE entity_type = '${entityType}' AND entity_id = ${entityAlias}.id
    ORDER BY analyzed_at DESC
    LIMIT 1
  ) AS ${analysisAlias} ON true
  LEFT JOIN LATERAL (
    SELECT label
    FROM sentiment_overrides
    WHERE entity_type = '${entityType}' AND entity_id = ${entityAlias}.id
    ORDER BY created_at DESC
    LIMIT 1
  ) AS ${overrideAlias} ON true
`;

export function registerListeningRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  app.post("/api/v1/sentiment/analyze-all", async (_request, reply) => {
    const result = await context.database.query<{
      total: string;
      pending: string;
      queued: string;
    }>(
      `
        WITH RECURSIVE reply_ancestors AS (
          SELECT child.id AS descendant_id,
                 parent.id AS ancestor_id,
                 parent.parent_comment_id,
                 parent.body,
                 parent.observed_order,
                 1 AS depth
          FROM comments AS child
          JOIN comments AS parent
            ON parent.id = child.parent_comment_id
          WHERE child.workspace_id = $1
            AND parent.workspace_id = $1

          UNION ALL

          SELECT ancestry.descendant_id,
                 parent.id AS ancestor_id,
                 parent.parent_comment_id,
                 parent.body,
                 parent.observed_order,
                 ancestry.depth + 1
          FROM reply_ancestors AS ancestry
          JOIN comments AS parent
            ON parent.id = ancestry.parent_comment_id
          WHERE ancestry.depth < 8
            AND parent.workspace_id = $1
        ),
        reply_descendants AS (
          SELECT parent.id AS target_id,
                 child.id AS descendant_id,
                 child.parent_comment_id,
                 child.body,
                 child.observed_order,
                 1 AS depth
          FROM comments AS parent
          JOIN comments AS child
            ON child.parent_comment_id = parent.id
          WHERE parent.workspace_id = $1
            AND child.workspace_id = $1

          UNION ALL

          SELECT descendants.target_id,
                 child.id AS descendant_id,
                 child.parent_comment_id,
                 child.body,
                 child.observed_order,
                 descendants.depth + 1
          FROM reply_descendants AS descendants
          JOIN comments AS child
            ON child.parent_comment_id = descendants.descendant_id
          WHERE descendants.depth < 8
            AND child.workspace_id = $1
        ),
        conversation_items AS (
          SELECT ancestry.descendant_id AS target_id,
                 ancestry.ancestor_id AS entity_id,
                 ancestry.parent_comment_id,
                 ancestry.body,
                 ancestry.observed_order,
                 ancestry.depth,
                 'ancestor'::text AS relation,
                 0 AS section
          FROM reply_ancestors AS ancestry

          UNION ALL

          SELECT comment.id AS target_id,
                 comment.id AS entity_id,
                 comment.parent_comment_id,
                 comment.body,
                 comment.observed_order,
                 0 AS depth,
                 'target'::text AS relation,
                 1 AS section
          FROM comments AS comment
          WHERE comment.workspace_id = $1

          UNION ALL

          SELECT descendants.target_id,
                 descendants.descendant_id AS entity_id,
                 descendants.parent_comment_id,
                 descendants.body,
                 descendants.observed_order,
                 descendants.depth,
                 'reply'::text AS relation,
                 2 AS section
          FROM reply_descendants AS descendants
        ),
        ranked_conversation_items AS (
          SELECT item.*,
                 row_number() OVER (
                   PARTITION BY item.target_id
                   ORDER BY item.section,
                            CASE
                              WHEN item.section = 0 THEN -item.depth
                              ELSE item.depth
                            END,
                            item.observed_order NULLS LAST,
                            item.entity_id
                 ) AS segment_order,
                 count(*) OVER (PARTITION BY item.target_id) AS segment_total
          FROM conversation_items AS item
        ),
        conversation_context AS (
          SELECT target_id,
                 min(entity_id::text) FILTER (
                   WHERE parent_comment_id IS NULL
                 )::uuid AS root_comment_id,
                 jsonb_build_object(
                   'version', 2,
                   'mode', 'comment_with_replies',
                   'targetCommentId', target_id,
                   'truncated', max(segment_total) > 60,
                   'items', jsonb_agg(
                     jsonb_build_object(
                       'entityId', entity_id,
                       'parentEntityId', parent_comment_id,
                       'level', depth,
                       'relation', relation,
                       'text', left(body, 1500)
                     )
                     ORDER BY segment_order
                   )
                 )::text AS conversation_context
          FROM ranked_conversation_items
          WHERE segment_order <= 60
          GROUP BY target_id
        ),
        source_entities AS (
          SELECT post.workspace_id,
                 'post'::text AS entity_type,
                 post.id AS entity_id,
                 post.body AS text,
                 NULL::text AS post_context,
                 NULL::text AS conversation_context,
                 NULL::uuid AS conversation_group_id
          FROM posts AS post
          WHERE post.workspace_id = $1

          UNION ALL

          SELECT comment.workspace_id,
                 'comment'::text AS entity_type,
                 comment.id AS entity_id,
                 comment.body AS text,
                 left(post.body, 4000) AS post_context,
                 conversation_context.conversation_context,
                 conversation_context.root_comment_id AS conversation_group_id
          FROM comments AS comment
          JOIN posts AS post ON post.id = comment.post_id
          LEFT JOIN conversation_context
            ON conversation_context.target_id = comment.id
          WHERE comment.workspace_id = $1
        ),
        pending AS (
          SELECT source.*
          FROM source_entities AS source
          WHERE NOT EXISTS (
                  SELECT 1
                  FROM sentiment_analyses AS analysis
                  WHERE analysis.entity_type = source.entity_type
                    AND analysis.entity_id = source.entity_id
                )
            AND NOT EXISTS (
                  SELECT 1
                  FROM sentiment_overrides AS override
                  WHERE override.entity_type = source.entity_type
                    AND override.entity_id = source.entity_id
                )
        ),
        queued AS (
          INSERT INTO sentiment_queue (
            workspace_id,
            entity_type,
            entity_id,
            text,
            post_context,
            conversation_context,
            conversation_group_id,
            status,
            attempt_count,
            available_at
          )
          SELECT workspace_id,
                 entity_type,
                 entity_id,
                 text,
                 post_context,
                 conversation_context,
                 conversation_group_id,
                 'queued',
                 0,
                 now()
          FROM pending
          ON CONFLICT (entity_type, entity_id)
          DO UPDATE SET
            workspace_id = EXCLUDED.workspace_id,
            text = EXCLUDED.text,
            post_context = EXCLUDED.post_context,
            conversation_context = EXCLUDED.conversation_context,
            conversation_group_id = EXCLUDED.conversation_group_id,
            status = 'queued',
            attempt_count = 0,
            available_at = now(),
            locked_at = NULL,
            completed_at = NULL,
            last_error = NULL,
            updated_at = now()
          WHERE sentiment_queue.status = 'failed'
          RETURNING entity_type, entity_id
        )
        SELECT (SELECT count(*)::text FROM source_entities) AS total,
               (SELECT count(*)::text FROM pending) AS pending,
               (SELECT count(*)::text FROM queued) AS queued
      `,
      [context.config.workspaceId],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    const pending = Number(result.rows[0]?.pending ?? 0);
    const queued = Number(result.rows[0]?.queued ?? 0);
    return reply.code(202).send({
      total,
      pending,
      queued,
      skippedAlreadyAnalyzed: total - pending,
      skippedAlreadyQueued: pending - queued,
    });
  });

  app.get("/api/v1/listening/posts", async (request) => {
    const query = parseWith(listeningFilterSchema, request.query);
    const filters = filterSql(query, "post");
    filters.values.unshift(context.config.workspaceId);
    filters.conditions.unshift("post.workspace_id = $1");
    // Shift placeholders generated before workspace was prepended.
    filters.conditions = filters.conditions.map((condition, index) =>
      index === 0
        ? condition
        : condition.replace(/\$(\d+)/g, (_, value: string) => `$${Number(value) + 1}`),
    );
    if (query.sourceId) {
      filters.values.push(query.sourceId);
      filters.conditions.push(`post.source_id = $${filters.values.length}`);
    }
    if (query.keywordId) {
      filters.values.push(query.keywordId);
      filters.conditions.push(
        `EXISTS (
          SELECT 1 FROM keyword_hits AS hit
          WHERE hit.entity_type = 'post'
            AND hit.entity_id = post.id
            AND hit.keyword_id = $${filters.values.length}
        )`,
      );
    }
    if (query.sentiment) {
      filters.values.push(query.sentiment);
      filters.conditions.push(
        `COALESCE(override.label, analysis.label) = $${filters.values.length}`,
      );
    }
    filters.values.push(query.limit, query.offset);
    const result = await context.database.query<ContentRow>(
      `
        SELECT post.id,
               post.platform,
               post.external_id,
               post.source_id,
               source.name AS source_name,
               post.canonical_url,
               post.body,
               post.published_at,
               post.collected_at,
               post.time_parse_status,
               post.author_name,
               post.is_anonymous,
               post.author_kind,
               post.anonymous_avatar_variant,
               COALESCE(
                 keyword_context.matched_keywords,
                 '[]'::jsonb
               ) AS matched_keywords,
               COALESCE(override.label, analysis.label) AS sentiment_label,
               CASE
                 WHEN override.label IS NOT NULL THEN 1
                 ELSE analysis.confidence
               END AS sentiment_confidence,
               CASE
                 WHEN override.label IS NOT NULL THEN true
                 ELSE analysis.is_relevant
               END AS sentiment_relevant,
               CASE
                 WHEN override.label IS NOT NULL THEN false
                 ELSE analysis.needs_review
               END AS sentiment_needs_review
        FROM posts AS post
        JOIN sources AS source ON source.id = post.source_id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'id', hit.keyword_id,
                     'value', hit.matched_keyword_value,
                     'matchMode', hit.matched_match_mode
                   )
                   ORDER BY hit.matched_keyword_value, hit.keyword_id
                 ) AS matched_keywords
          FROM keyword_hits AS hit
          WHERE hit.entity_type = 'post'
            AND hit.entity_id = post.id
        ) AS keyword_context ON true
        ${latestSentimentSql("post", "post")}
        WHERE ${filters.conditions.join(" AND ")}
        ORDER BY post.collected_at DESC
        LIMIT $${filters.values.length - 1}
        OFFSET $${filters.values.length}
      `,
      filters.values,
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        platform: row.platform,
        externalId: row.external_id,
        sourceId: row.source_id,
        sourceName: row.source_name,
        url: row.canonical_url,
        body: row.body,
        publishedAt: toIso(row.published_at),
        collectedAt: toIso(row.collected_at),
        timeParseStatus: row.time_parse_status,
        author: authorFromRow(row),
        matchedKeywords: row.matched_keywords ?? [],
        sentiment: sentimentFromRow(row),
      })),
    };
  });

  app.get("/api/v1/listening/comments", async (request) => {
    const query = parseWith(listeningFilterSchema, request.query);
    const filters = filterSql(query, "comment");
    filters.values.unshift(context.config.workspaceId);
    filters.conditions.unshift("comment.workspace_id = $1");
    filters.conditions = filters.conditions.map((condition, index) =>
      index === 0
        ? condition
        : condition.replace(/\$(\d+)/g, (_, value: string) => `$${Number(value) + 1}`),
    );
    if (query.sourceId) {
      filters.values.push(query.sourceId);
      filters.conditions.push(`post.source_id = $${filters.values.length}`);
    }
    if (query.keywordId) {
      filters.values.push(query.keywordId);
      filters.conditions.push(
        `EXISTS (
          SELECT 1 FROM keyword_hits AS hit
          WHERE hit.entity_type = 'post'
            AND hit.entity_id = post.id
            AND hit.keyword_id = $${filters.values.length}
        )`,
      );
    }
    if (query.sentiment) {
      filters.values.push(query.sentiment);
      filters.conditions.push(
        `COALESCE(override.label, analysis.label) = $${filters.values.length}`,
      );
    }
    filters.values.push(query.limit, query.offset);
    const result = await context.database.query<ContentRow>(
      `
        SELECT comment.id,
               comment.platform,
               comment.external_id,
               post.source_id,
               source.name AS source_name,
               comment.post_id,
               post.external_id AS post_external_id,
               post.canonical_url AS post_url,
               post.body AS post_body,
               post.published_at AS post_published_at,
               post.collected_at AS post_collected_at,
               post.time_parse_status AS post_time_parse_status,
               post.author_name AS post_author_name,
               post.is_anonymous AS post_is_anonymous,
               post.author_kind AS post_author_kind,
               post.anonymous_avatar_variant AS post_anonymous_avatar_variant,
               COALESCE(post_override.label, post_analysis.label)
                 AS post_sentiment_label,
               CASE
                 WHEN post_override.label IS NOT NULL THEN 1
                 ELSE post_analysis.confidence
               END AS post_sentiment_confidence,
               CASE
                 WHEN post_override.label IS NOT NULL THEN true
                 ELSE post_analysis.is_relevant
               END AS post_sentiment_relevant,
               CASE
                 WHEN post_override.label IS NOT NULL THEN false
                 ELSE post_analysis.needs_review
               END AS post_sentiment_needs_review,
               COALESCE(
                 keyword_context.matched_keywords,
                 '[]'::jsonb
               ) AS matched_keywords,
               comment.parent_comment_id,
               comment.observed_order,
               comment.canonical_url,
               comment.body,
               comment.published_at,
               comment.collected_at,
               comment.time_parse_status,
               comment.author_name,
               comment.is_anonymous,
               comment.author_kind,
               comment.anonymous_avatar_variant,
               COALESCE(override.label, analysis.label) AS sentiment_label,
               CASE
                 WHEN override.label IS NOT NULL THEN 1
                 ELSE analysis.confidence
               END AS sentiment_confidence,
               CASE
                 WHEN override.label IS NOT NULL THEN true
                 ELSE analysis.is_relevant
               END AS sentiment_relevant,
               CASE
                 WHEN override.label IS NOT NULL THEN false
                 ELSE analysis.needs_review
               END AS sentiment_needs_review
        FROM comments AS comment
        JOIN posts AS post ON post.id = comment.post_id
        JOIN sources AS source ON source.id = post.source_id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'id', hit.keyword_id,
                     'value', hit.matched_keyword_value,
                     'matchMode', hit.matched_match_mode
                   )
                   ORDER BY hit.matched_keyword_value, hit.keyword_id
                 ) AS matched_keywords
          FROM keyword_hits AS hit
          WHERE hit.entity_type = 'post'
            AND hit.entity_id = post.id
        ) AS keyword_context ON true
        ${latestSentimentSql("comment", "comment")}
        ${latestSentimentSql(
          "post",
          "post",
          "post_analysis",
          "post_override",
        )}
        WHERE ${filters.conditions.join(" AND ")}
        ORDER BY comment.collected_at DESC
        LIMIT $${filters.values.length - 1}
        OFFSET $${filters.values.length}
      `,
      filters.values,
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        platform: row.platform,
        externalId: row.external_id,
        postId: row.post_id,
        postExternalId: row.post_external_id,
        post: {
          id: row.post_id,
          externalId: row.post_external_id,
          sourceId: row.source_id,
          sourceName: row.source_name,
          url: row.post_url,
          body: row.post_body,
          publishedAt: toIso(row.post_published_at ?? null),
          collectedAt: toIso(row.post_collected_at ?? null),
          timeParseStatus: row.post_time_parse_status,
          author: {
            authorName:
              row.post_author_kind === "real"
                ? (row.post_author_name ?? null)
                : null,
            isAnonymous: row.post_is_anonymous ?? false,
            authorKind: row.post_author_kind ?? "unknown",
            ...(row.post_author_kind === "anonymous" &&
            row.post_anonymous_avatar_variant !== null &&
            row.post_anonymous_avatar_variant !== undefined
              ? {
                  anonymousAvatarVariant:
                    row.post_anonymous_avatar_variant,
                }
              : {}),
          },
          matchedKeywords: row.matched_keywords ?? [],
          sentiment: row.post_sentiment_label
            ? {
                label: row.post_sentiment_label,
                confidence: Number(row.post_sentiment_confidence ?? 0),
                isRelevant: row.post_sentiment_relevant ?? true,
                needsReview: row.post_sentiment_needs_review ?? false,
              }
            : null,
        },
        parentCommentId: row.parent_comment_id ?? null,
        observedOrder: row.observed_order ?? null,
        sourceId: row.source_id,
        sourceName: row.source_name,
        url: row.canonical_url,
        body: row.body,
        publishedAt: toIso(row.published_at),
        collectedAt: toIso(row.collected_at),
        timeParseStatus: row.time_parse_status,
        author: authorFromRow(row),
        sentiment: sentimentFromRow(row),
      })),
    };
  });

  app.post(
    "/api/v1/sentiment/:entityType/:entityId/override",
    async (request, reply) => {
      const params = parseWith(sentimentParamsSchema, request.params);
      const override = parseWith(sentimentOverrideSchema, request.body);
      const entityTable =
        params.entityType === "post" ? "posts" : "comments";
      const exists = await context.database.query(
        `SELECT 1 FROM ${entityTable} WHERE id = $1 AND workspace_id = $2`,
        [params.entityId, context.config.workspaceId],
      );
      if (!exists.rowCount) {
        return notFound(`${params.entityType} not found`);
      }
      const result = await context.database.query<{ id: string; created_at: Date }>(
        `
          INSERT INTO sentiment_overrides (
            workspace_id, entity_type, entity_id, label, reason
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, created_at
        `,
        [
          context.config.workspaceId,
          params.entityType,
          params.entityId,
          override.label,
          override.reason,
        ],
      );
      return reply.code(201).send({
        id: result.rows[0]!.id,
        ...params,
        ...override,
        createdAt: toIso(result.rows[0]!.created_at),
      });
    },
  );
}
