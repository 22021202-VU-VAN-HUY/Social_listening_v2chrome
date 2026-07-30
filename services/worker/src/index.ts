import { loadConfig } from "./config.js";
import { checkDatabase, createPool } from "./db.js";
import { createSentimentProvider } from "./sentiment/provider-factory.js";
import { SentimentRepository } from "./sentiment/repository.js";
import { SentimentWorker } from "./sentiment/worker.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const provider = createSentimentProvider(config);
const repository = new SentimentRepository(pool);
const worker = new SentimentWorker(repository, provider, config);

async function shutdown(signal: string): Promise<void> {
  console.info(JSON.stringify({ event: "worker_stopping", signal }));
  worker.stop();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await checkDatabase(pool);
console.info(
  JSON.stringify({
    event: "worker_started",
    provider: provider.name,
    model: provider.model,
  }),
);
await worker.runForever();
