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
    entityType: z.literal("comment"),
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
  matched_keywords?: Array<{
    id: string;
    value: string;
    matchMode: "whole_word" | "contains_phrase";
  }>;
  parent_comment_id?: string | null;
  canonical_url: string | null;
  body: string;
  published_at: Date | null;
  collected_at: Date;
  time_parse_status: "parsed" | "unknown";
  author_name: string | null;
  is_anonymous: boolean;
  author_kind: "real" | "anonymous" | "unknown";
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

const latestCommentSentimentSql = (entityAlias: string) => `
  LEFT JOIN LATERAL (
    SELECT label, confidence, is_relevant, needs_review
    FROM sentiment_analyses
    WHERE entity_type = 'comment' AND entity_id = ${entityAlias}.id
    ORDER BY analyzed_at DESC
    LIMIT 1
  ) AS analysis ON true
  LEFT JOIN LATERAL (
    SELECT label
    FROM sentiment_overrides
    WHERE entity_type = 'comment' AND entity_id = ${entityAlias}.id
    ORDER BY created_at DESC
    LIMIT 1
  ) AS override ON true
`;

export function registerListeningRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  app.post("/api/v1/sentiment/analyze-all", async (_request, reply) => {
    const result = await context.database.query<{
      total: string;
      queued: string;
    }>(
      `
        WITH source_comments AS (
          SELECT comment.workspace_id,
                 comment.id AS entity_id,
                 comment.body AS text,
                 left(post.body, 2000) AS post_context
          FROM comments AS comment
          JOIN posts AS post ON post.id = comment.post_id
          WHERE comment.workspace_id = $1
        ),
        queued AS (
          INSERT INTO sentiment_queue (
            workspace_id,
            entity_type,
            entity_id,
            text,
            post_context,
            status,
            attempt_count,
            available_at
          )
          SELECT workspace_id,
                 'comment',
                 entity_id,
                 text,
                 post_context,
                 'queued',
                 0,
                 now()
          FROM source_comments
          ON CONFLICT (entity_type, entity_id)
          DO UPDATE SET
            workspace_id = EXCLUDED.workspace_id,
            text = EXCLUDED.text,
            post_context = EXCLUDED.post_context,
            status = 'queued',
            attempt_count = 0,
            available_at = now(),
            locked_at = NULL,
            completed_at = NULL,
            last_error = NULL,
            updated_at = now()
          WHERE sentiment_queue.status <> 'processing'
          RETURNING entity_id
        )
        SELECT (SELECT count(*)::text FROM source_comments) AS total,
               (SELECT count(*)::text FROM queued) AS queued
      `,
      [context.config.workspaceId],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    const queued = Number(result.rows[0]?.queued ?? 0);
    return reply.code(202).send({
      total,
      queued,
      skippedProcessing: total - queued,
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
      // Posts are context records, never sentiment entities.
      filters.conditions.push("false");
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
               COALESCE(
                 keyword_context.matched_keywords,
                 '[]'::jsonb
               ) AS matched_keywords,
               NULL::text AS sentiment_label,
               NULL::numeric AS sentiment_confidence,
               NULL::boolean AS sentiment_relevant,
               NULL::boolean AS sentiment_needs_review
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
        sentiment: null,
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
               COALESCE(
                 keyword_context.matched_keywords,
                 '[]'::jsonb
               ) AS matched_keywords,
               comment.parent_comment_id,
               comment.canonical_url,
               comment.body,
               comment.published_at,
               comment.collected_at,
               comment.time_parse_status,
               comment.author_name,
               comment.is_anonymous,
               comment.author_kind,
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
        ${latestCommentSentimentSql("comment")}
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
          },
          matchedKeywords: row.matched_keywords ?? [],
        },
        parentCommentId: row.parent_comment_id ?? null,
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
      const exists = await context.database.query(
        "SELECT 1 FROM comments WHERE id = $1 AND workspace_id = $2",
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
