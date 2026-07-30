import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const database = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 1,
  application_name: "listening-socialmediav2-migrate",
});

try {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationsDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../migrations",
  );
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const alreadyApplied = await database.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [file],
    );
    if (alreadyApplied.rowCount) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    const transaction = await database.connect();
    try {
      await transaction.query("BEGIN");
      await transaction.query("SELECT pg_advisory_xact_lock(8675309)");
      await transaction.query(sql);
      await transaction.query(
        "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
        [file],
      );
      await transaction.query("COMMIT");
      process.stdout.write(`Applied ${file}\n`);
    } catch (error) {
      await transaction.query("ROLLBACK");
      throw error;
    } finally {
      transaction.release();
    }
  }
} finally {
  await database.end();
}
