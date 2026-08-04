import { loadConfig } from "./config.js";
import { checkDatabase, createPool } from "./db.js";
import { createSentimentProvider } from "./sentiment/provider-factory.js";
import { SentimentRepository } from "./sentiment/repository.js";
import { SentimentWorker } from "./sentiment/worker.js";
import { ThreadsClient } from "./threads/client.js";
import { ThreadsRepository } from "./threads/repository.js";
import { ThreadsWorker } from "./threads/worker.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const provider = createSentimentProvider(config);
const repository = new SentimentRepository(pool);
const worker = new SentimentWorker(repository, provider, config);
const threadsWorker = config.THREADS_ACCESS_TOKEN
  ? new ThreadsWorker(
      new ThreadsRepository(pool, config.WORKSPACE_ID),
      new ThreadsClient({
        baseUrl: config.THREADS_GRAPH_BASE_URL,
        apiVersion: config.THREADS_API_VERSION,
        accessToken: config.THREADS_ACCESS_TOKEN,
      }),
      config,
    )
  : null;

async function shutdown(signal: string): Promise<void> {
  console.info(JSON.stringify({ event: "worker_stopping", signal }));
  worker.stop();
  threadsWorker?.stop();
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
    threadsConnector: threadsWorker ? "enabled" : "disabled_missing_token",
  }),
);
await Promise.all([
  worker.runForever(),
  ...(threadsWorker ? [threadsWorker.runForever()] : []),
]);
