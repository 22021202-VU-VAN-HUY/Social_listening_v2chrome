import {
  platformSchema,
  updatePlatformSettingsSchema,
} from "@listening-social/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { notFound } from "../errors.js";
import { parseWith } from "../validation.js";

const platformParamsSchema = z.object({ platform: platformSchema }).strict();

export function registerSettingsRoutes(
  app: FastifyInstance,
  context: AppContext,
): void {
  app.get("/api/v1/settings/:platform", async (request) => {
    const { platform } = parseWith(platformParamsSchema, request.params);
    const result = await context.database.query<{
      platform: "facebook" | "tiktok" | "threads";
      lookback_preset: "today" | "3_days" | "7_days" | "30_days";
      crawl_comments: boolean;
      max_sources_per_job: number;
      max_posts_per_source: number;
      max_comments_per_post: number;
      max_runtime_minutes: number;
      enabled: boolean;
    }>(
      `
        SELECT platform,
               lookback_preset,
               crawl_comments,
               max_sources_per_job,
               max_posts_per_source,
               max_comments_per_post,
               max_runtime_minutes,
               enabled
        FROM platform_settings
        WHERE workspace_id = $1 AND platform = $2
      `,
      [context.config.workspaceId, platform],
    );
    const settings = result.rows[0];
    if (!settings) {
      return notFound(`Settings for ${platform} do not exist`);
    }
    return {
      platform: settings.platform,
      lookbackPreset: settings.lookback_preset,
      crawlComments: settings.crawl_comments,
      maxSourcesPerJob: settings.max_sources_per_job,
      maxPostsPerSource: settings.max_posts_per_source,
      maxCommentsPerPost: settings.max_comments_per_post,
      maxRuntimeMinutes: settings.max_runtime_minutes,
      enabled: settings.enabled,
    };
  });

  app.put("/api/v1/settings/:platform", async (request) => {
    const { platform } = parseWith(platformParamsSchema, request.params);
    const settings = parseWith(updatePlatformSettingsSchema, request.body);
    const result = await context.database.query(
      `
        INSERT INTO platform_settings (
          workspace_id,
          platform,
          lookback_preset,
          crawl_comments,
          max_sources_per_job,
          max_posts_per_source,
          max_comments_per_post,
          max_runtime_minutes,
          enabled
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (workspace_id, platform)
        DO UPDATE SET
          lookback_preset = EXCLUDED.lookback_preset,
          crawl_comments = EXCLUDED.crawl_comments,
          max_sources_per_job = EXCLUDED.max_sources_per_job,
          max_posts_per_source = EXCLUDED.max_posts_per_source,
          max_comments_per_post = EXCLUDED.max_comments_per_post,
          max_runtime_minutes = EXCLUDED.max_runtime_minutes,
          enabled = EXCLUDED.enabled,
          updated_at = now()
        RETURNING platform
      `,
      [
        context.config.workspaceId,
        platform,
        settings.lookbackPreset,
        settings.crawlComments,
        settings.maxSourcesPerJob,
        settings.maxPostsPerSource,
        settings.maxCommentsPerPost,
        settings.maxRuntimeMinutes,
        settings.enabled,
      ],
    );
    return { updated: result.rowCount === 1 };
  });
}
