import { dashboardFilterSchema } from "@listening-social/contracts";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { parseWith } from "../validation.js";

function dashboardFilters(
  query: ReturnType<typeof dashboardFilterSchema.parse>,
  parsedTimeOnly: boolean,
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (query.platform) {
    values.push(query.platform);
    conditions.push(`comment.platform = $${values.length}`);
  }
  if (query.sourceId) {
    values.push(query.sourceId);
    conditions.push(`post.source_id = $${values.length}`);
  }
  if (query.from) {
    values.push(query.from);
    conditions.push(`comment.published_at >= $${values.length}`);
  }
  if (query.to) {
    values.push(query.to);
    conditions.push(`comment.published_at <= $${values.length}`);
  }
  if (parsedTimeOnly) {
    conditions.push("comment.time_parse_status = 'parsed'");
  }
  return {
    sql: conditions.length ? `AND ${conditions.join(" AND ")}` : "",
    values,
  };
}

const dashboardContentCte = `
  WITH content AS (
    SELECT comment.id,
           'comment'::text AS entity_type,
           comment.workspace_id,
           comment.platform,
           post.source_id,
           comment.post_id,
           comment.parent_comment_id,
           comment.published_at,
           comment.time_parse_status
    FROM comments AS comment
    JOIN posts AS post ON post.id = comment.post_id
    WHERE comment.workspace_id = $1
      __COMMENT_FILTERS__
  ),
  enriched AS (
    SELECT content.*,
           COALESCE(override.label, analysis.label) AS label,
           CASE
             WHEN override.label IS NOT NULL THEN true
             ELSE analysis.is_relevant
           END AS is_relevant
    FROM content
    LEFT JOIN LATERAL (
      SELECT label, is_relevant
      FROM sentiment_analyses
      WHERE entity_type = content.entity_type
        AND entity_id = content.id
      ORDER BY analyzed_at DESC
      LIMIT 1
    ) AS analysis ON true
    LEFT JOIN LATERAL (
      SELECT label
      FROM sentiment_overrides
      WHERE entity_type = content.entity_type
        AND entity_id = content.id
      ORDER BY created_at DESC
      LIMIT 1
    ) AS override ON true
`;

export function registerDashboardRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  app.get("/api/v1/dashboard/summary", async (request) => {
    const query = parseWith(dashboardFilterSchema, request.query);
    const filters = dashboardFilters(query, false);
    filters.values.unshift(context.config.workspaceId);
    const shifted = filters.sql.replace(
      /\$(\d+)/g,
      (_, position: string) => `$${Number(position) + 1}`,
    );
    const contentCte = dashboardContentCte.replace(
      "__COMMENT_FILTERS__",
      shifted,
    );
    const result = await context.database.query<{
      total: string;
      posts: string;
      comments: string;
      replies: string;
      unknown_time: string;
      relevant: string;
      positive: string;
      negative: string;
      neutral: string;
      pending_analysis: string;
    }>(
      `
        ${contentCte}
        )
        SELECT count(*)::text AS total,
               count(DISTINCT post_id)::text AS posts,
               count(*) FILTER (
                 WHERE parent_comment_id IS NULL
               )::text AS comments,
               count(*) FILTER (
                 WHERE parent_comment_id IS NOT NULL
               )::text AS replies,
               count(*) FILTER (
                 WHERE time_parse_status = 'unknown'
               )::text AS unknown_time,
               count(*) FILTER (WHERE is_relevant = true)::text AS relevant,
               count(*) FILTER (
                 WHERE is_relevant = true AND label = 'positive'
               )::text AS positive,
               count(*) FILTER (
                 WHERE is_relevant = true AND label = 'negative'
               )::text AS negative,
               count(*) FILTER (
                 WHERE is_relevant = true AND label = 'neutral'
               )::text AS neutral,
               count(*) FILTER (WHERE label IS NULL)::text AS pending_analysis
        FROM enriched
      `,
      filters.values,
    );
    const summary = result.rows[0]!;
    return {
      total: Number(summary.total),
      posts: Number(summary.posts),
      comments: Number(summary.comments),
      replies: Number(summary.replies),
      unknownTime: Number(summary.unknown_time),
      relevant: Number(summary.relevant),
      positive: Number(summary.positive),
      negative: Number(summary.negative),
      neutral: Number(summary.neutral),
      pendingAnalysis: Number(summary.pending_analysis),
    };
  });

  app.get("/api/v1/dashboard/timeline", async (request) => {
    const query = parseWith(dashboardFilterSchema, request.query);
    const filters = dashboardFilters(query, true);
    filters.values.unshift(context.config.workspaceId);
    const shifted = filters.sql.replace(
      /\$(\d+)/g,
      (_, position: string) => `$${Number(position) + 1}`,
    );
    const contentCte = dashboardContentCte.replace(
      "__COMMENT_FILTERS__",
      shifted,
    );
    const result = await context.database.query<{
      date: string;
      label: "positive" | "negative" | "neutral";
      count: string;
    }>(
      `
        ${contentCte}
        )
        SELECT to_char(published_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')
                 AS date,
               label,
               count(*)::text AS count
        FROM enriched
        WHERE is_relevant = true AND label IS NOT NULL
        GROUP BY date, label
        ORDER BY date, label
      `,
      filters.values,
    );
    return {
      items: result.rows.map((row) => ({
        date: row.date,
        label: row.label,
        count: Number(row.count),
      })),
    };
  });
}
