import pg from "pg";
import type { ApiConfig } from "./config.js";

export type Database = pg.Pool;
export type Transaction = pg.PoolClient;

export function createDatabase(config: ApiConfig): Database {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.nodeEnv === "test" ? 4 : 20,
    application_name: "listening-socialmediav2-api",
  });
}

export async function inTransaction<T>(
  database: Database,
  operation: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  const transaction = await database.connect();
  try {
    await transaction.query("BEGIN");
    const result = await operation(transaction);
    await transaction.query("COMMIT");
    return result;
  } catch (error) {
    await transaction.query("ROLLBACK");
    throw error;
  } finally {
    transaction.release();
  }
}
