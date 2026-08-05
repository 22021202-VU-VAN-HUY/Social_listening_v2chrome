import {
  createKeywordSchema,
  idSchema,
  keywordListQuerySchema,
  updateKeywordSchema,
} from "@listening-social/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { inTransaction } from "../db.js";
import { notFound } from "../errors.js";
import { normalizeKeyword } from "../keywords.js";
import { toIso } from "../serialize.js";
import { parseWith } from "../validation.js";

const keywordParamsSchema = z.object({ id: idSchema }).strict();

interface KeywordRow {
  id: string;
  platform: "facebook" | "tiktok" | "threads";
  value: string;
  normalized_value: string;
  match_mode: "whole_word" | "contains_phrase";
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function serializeKeyword(row: KeywordRow) {
  return {
    id: row.id,
    platform: row.platform,
    value: row.value,
    normalizedValue: row.normalized_value,
    matchMode: row.match_mode,
    active: row.active,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function registerKeywordRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  app.get("/api/v1/keywords", async (request) => {
    const query = parseWith(keywordListQuerySchema, request.query);
    const values: unknown[] = [context.config.workspaceId];
    const conditions = ["workspace_id = $1"];
    if (query.platform) {
      values.push(query.platform);
      conditions.push(`platform = $${values.length}`);
    }
    if (query.active) {
      values.push(query.active === "true");
      conditions.push(`active = $${values.length}`);
    }
    const result = await context.database.query<KeywordRow>(
      `
        SELECT id, platform, value, normalized_value, match_mode, active,
               created_at, updated_at
        FROM keywords
        WHERE ${conditions.join(" AND ")}
        ORDER BY platform, created_at
      `,
      values,
    );
    return { items: result.rows.map(serializeKeyword) };
  });

  app.post("/api/v1/keywords", async (request, reply) => {
    const keyword = parseWith(createKeywordSchema, request.body);
    const result = await context.database.query<KeywordRow>(
      `
        INSERT INTO keywords (
          workspace_id, platform, value, normalized_value, match_mode, active
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (workspace_id, platform, normalized_value)
        DO UPDATE SET
          value = EXCLUDED.value,
          match_mode = EXCLUDED.match_mode,
          active = EXCLUDED.active,
          updated_at = now()
        RETURNING id, platform, value, normalized_value, match_mode, active,
                  created_at, updated_at
      `,
      [
        context.config.workspaceId,
        keyword.platform,
        keyword.value,
        normalizeKeyword(keyword.value),
        keyword.matchMode,
        keyword.active,
      ],
    );
    return reply.code(201).send(serializeKeyword(result.rows[0]!));
  });

  app.patch("/api/v1/keywords/:id", async (request) => {
    const { id } = parseWith(keywordParamsSchema, request.params);
    const change = parseWith(updateKeywordSchema, request.body);
    return inTransaction(context.database, async (transaction) => {
      const currentResult = await transaction.query<KeywordRow>(
        `
          SELECT id, platform, value, normalized_value, match_mode, active,
                 created_at, updated_at
          FROM keywords
          WHERE id = $1 AND workspace_id = $2
          FOR UPDATE
        `,
        [id, context.config.workspaceId],
      );
      const current = currentResult.rows[0];
      if (!current) {
        return notFound("Keyword not found");
      }
      const value = change.value ?? current.value;
      const result = await transaction.query<KeywordRow>(
        `
          UPDATE keywords
          SET value = $3,
              normalized_value = $4,
              match_mode = $5,
              active = $6,
              updated_at = now()
          WHERE id = $1 AND workspace_id = $2
          RETURNING id, platform, value, normalized_value, match_mode, active,
                    created_at, updated_at
        `,
        [
          id,
          context.config.workspaceId,
          value,
          normalizeKeyword(value),
          change.matchMode ?? current.match_mode,
          change.active ?? current.active,
        ],
      );
      return serializeKeyword(result.rows[0]!);
    });
  });

  app.delete("/api/v1/keywords/:id", async (request, reply) => {
    const { id } = parseWith(keywordParamsSchema, request.params);
    const result = await context.database.query(
      `
        UPDATE keywords
        SET active = false,
            updated_at = now()
        WHERE id = $1 AND workspace_id = $2
      `,
      [id, context.config.workspaceId],
    );
    if (!result.rowCount) {
      return notFound("Keyword not found");
    }
    return reply.code(204).send();
  });
}
