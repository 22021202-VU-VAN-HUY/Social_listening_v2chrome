import {
  sourceListQuerySchema,
  updateSourceSelectionSchema,
} from "@listening-social/contracts";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { inTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { toIso } from "../serialize.js";
import { parseWith } from "../validation.js";

interface SourceRow {
  id: string;
  platform: "facebook" | "tiktok" | "threads";
  external_id: string;
  name: string;
  canonical_url: string;
  active: boolean;
  selected: boolean;
  last_discovered_at: Date | null;
  last_crawl_error: string | null;
}

export function registerSourceRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  app.get("/api/v1/sources", async (request) => {
    const query = parseWith(sourceListQuerySchema, request.query);
    const values: unknown[] = [context.config.workspaceId, query.platform];
    const conditions = ["source.workspace_id = $1", "source.platform = $2"];
    if (query.search) {
      values.push(`%${query.search}%`);
      conditions.push(`source.name ILIKE $${values.length}`);
    }
    if (query.selected) {
      values.push(query.selected === "true");
      conditions.push(`COALESCE(selection.selected, false) = $${values.length}`);
    }
    values.push(query.limit, query.offset);
    const result = await context.database.query<SourceRow>(
      `
        SELECT source.id,
               source.platform,
               source.external_id,
               source.name,
               source.canonical_url,
               source.active,
               COALESCE(selection.selected, false) AS selected,
               source.last_discovered_at,
               source.last_crawl_error
        FROM sources AS source
        LEFT JOIN source_selections AS selection
          ON selection.workspace_id = source.workspace_id
         AND selection.source_id = source.id
        WHERE ${conditions.join(" AND ")}
        ORDER BY source.name
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `,
      values,
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        platform: row.platform,
        externalId: row.external_id,
        name: row.name,
        canonicalUrl: row.canonical_url,
        active: row.active,
        selected: row.selected,
        lastDiscoveredAt: toIso(row.last_discovered_at),
        lastCrawlError: row.last_crawl_error,
      })),
    };
  });

  app.put("/api/v1/sources/selection", async (request) => {
    const selection = parseWith(updateSourceSelectionSchema, request.body);
    return inTransaction(context.database, async (transaction) => {
      const sourceCount = await transaction.query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM sources
          WHERE workspace_id = $1
            AND platform = $2
            AND id = ANY($3::uuid[])
        `,
        [context.config.workspaceId, selection.platform, selection.sourceIds],
      );
      if (Number(sourceCount.rows[0]?.count ?? 0) !== selection.sourceIds.length) {
        throw new ApiError(
          400,
          "INVALID_SOURCE_SELECTION",
          "One or more source IDs do not belong to this workspace and platform",
        );
      }

      await transaction.query(
        `
          INSERT INTO source_selections (workspace_id, source_id, selected, selected_at)
          SELECT $1, id, false, NULL
          FROM sources
          WHERE workspace_id = $1 AND platform = $2
          ON CONFLICT (workspace_id, source_id)
          DO UPDATE SET selected = false, selected_at = NULL, updated_at = now()
        `,
        [context.config.workspaceId, selection.platform],
      );
      if (selection.sourceIds.length > 0) {
        await transaction.query(
          `
            UPDATE source_selections
            SET selected = true, selected_at = now(), updated_at = now()
            WHERE workspace_id = $1 AND source_id = ANY($2::uuid[])
          `,
          [context.config.workspaceId, selection.sourceIds],
        );
      }
      return { selectedCount: selection.sourceIds.length };
    });
  });
}
