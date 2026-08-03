import "dotenv/config";
import pg from "pg";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const database = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 1,
  application_name: "listening-socialmediav2-seed",
});

const defaults = [
  { value: "VSF", normalized: "vsf", matchMode: "whole_word" },
  {
    value: "VinSmart Future",
    normalized: "vinsmart future",
    matchMode: "contains_phrase",
  },
  { value: "Vinfuture", normalized: "vinfuture", matchMode: "contains_phrase" },
  { value: "Vin Future", normalized: "vin future", matchMode: "contains_phrase" },
] as const;

try {
  await database.query(
    `
      INSERT INTO workspaces (id, name, timezone, retention_days)
      VALUES ($1, 'VinSmart Future Listening', 'Asia/Ho_Chi_Minh', 180)
      ON CONFLICT (id) DO UPDATE SET updated_at = now()
    `,
    [config.workspaceId],
  );

  for (const platform of ["facebook", "tiktok", "threads"] as const) {
    await database.query(
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
        VALUES ($1, $2, '7_days', true, 50, 300, 500, 120, $3)
        ON CONFLICT (workspace_id, platform) DO NOTHING
      `,
      [config.workspaceId, platform, platform === "facebook"],
    );
  }

  for (const keyword of defaults) {
    await database.query(
      `
        INSERT INTO keywords (
          workspace_id,
          platform,
          value,
          normalized_value,
          match_mode,
          active
        )
        VALUES ($1, 'facebook', $2, $3, $4, true)
        ON CONFLICT (workspace_id, platform, normalized_value) DO NOTHING
      `,
      [config.workspaceId, keyword.value, keyword.normalized, keyword.matchMode],
    );
  }

  process.stdout.write("Seeded workspace, platform settings, and default keywords.\n");
} finally {
  await database.end();
}
