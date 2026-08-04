import { z } from "zod";
import type { WorkerConfig } from "../config.js";
import { ThreadsApiError, ThreadsClient } from "./client.js";
import { mapThreadsRootPost } from "./mapper.js";
import { ThreadsRepository, type ThreadsTask } from "./repository.js";

const SnapshotSchema = z.object({
  windowStartUtc: z.string().datetime({ offset: true }),
  windowEndUtc: z.string().datetime({ offset: true }),
  limits: z.object({
    maxPostsPerSource: z.number().int().positive(),
    maxRuntimeMinutes: z.number().int().positive(),
  }),
});

const CheckpointSchema = z
  .object({
    afterCursor: z.string().nullable().default(null),
    pagesFetched: z.number().int().nonnegative().default(0),
    apiCalls: z.number().int().nonnegative().default(0),
    postsScanned: z.number().int().nonnegative().default(0),
    postsMatched: z.number().int().nonnegative().default(0),
    postsSaved: z.number().int().nonnegative().default(0),
  })
  .passthrough();

function safeFailure(error: unknown): {
  code: string;
  message: string;
  retry: boolean;
} {
  if (error instanceof ThreadsApiError) {
    return {
      code: error.code,
      message: error.message,
      retry: error.status === 429 || error.status >= 500,
    };
  }
  if (error instanceof Error) {
    return {
      code: error.name === "TimeoutError" ? "THREADS_TIMEOUT" : "THREADS_WORKER_ERROR",
      message: error.message,
      retry: error.name === "TimeoutError" || error instanceof TypeError,
    };
  }
  return { code: "THREADS_WORKER_ERROR", message: "Unknown worker error", retry: false };
}

export class ThreadsWorker {
  private stopped = false;

  constructor(
    private readonly repository: ThreadsRepository,
    private readonly client: ThreadsClient,
    private readonly config: WorkerConfig,
  ) {}

  stop(): void {
    this.stopped = true;
  }

  async runOnce(): Promise<number> {
    const task = await this.repository.claimTask();
    if (!task) return 0;
    try {
      await this.processTask(task);
    } catch (error) {
      const failure = safeFailure(error);
      try {
        await this.repository.setConnectionStatus("error", {
          mode: "keyword_search",
          lastErrorAt: new Date().toISOString(),
          lastErrorCode: failure.code,
        });
      } catch (connectionError) {
        console.warn(JSON.stringify({
          event: "threads_connection_status_update_failed",
          message: connectionError instanceof Error ? connectionError.message : "Unknown error",
        }));
      }
      await this.repository.failTask(task, {
        ...failure,
        maxAttempts: this.config.THREADS_MAX_ATTEMPTS,
      });
      return 1;
    }
    try {
      await this.repository.setConnectionStatus("connected", {
        mode: "keyword_search",
        lastSuccessAt: new Date().toISOString(),
      });
    } catch (connectionError) {
      console.warn(JSON.stringify({
        event: "threads_connection_status_update_failed",
        message: connectionError instanceof Error ? connectionError.message : "Unknown error",
      }));
    }
    return 1;
  }

  async runForever(): Promise<void> {
    while (!this.stopped) {
      const processed = await this.runOnce();
      if (processed === 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.THREADS_POLL_MS));
      }
    }
  }

  private async processTask(task: ThreadsTask): Promise<void> {
    const snapshot = SnapshotSchema.parse(task.settingsSnapshot);
    const checkpoint = CheckpointSchema.parse(task.checkpoint);
    const windowStart = new Date(snapshot.windowStartUtc);
    const windowEnd = new Date(snapshot.windowEndUtc);
    const deadline = task.startedAt.getTime() + snapshot.limits.maxRuntimeMinutes * 60_000;
    let afterCursor = checkpoint.afterCursor;
    let pagesFetched = checkpoint.pagesFetched;
    let apiCalls = checkpoint.apiCalls;
    let scanned = checkpoint.postsScanned;
    let matched = checkpoint.postsMatched;
    let saved = checkpoint.postsSaved;
    let truncated = false;

    while (!this.stopped) {
      if (!(await this.repository.isTaskActive(task))) return;
      if (
        Date.now() >= deadline ||
        pagesFetched >= this.config.THREADS_MAX_PAGES_PER_TASK ||
        saved >= snapshot.limits.maxPostsPerSource
      ) {
        truncated = true;
        break;
      }
      const remaining = snapshot.limits.maxPostsPerSource - saved;
      const reserved = await this.repository.reserveApiCall(
        task,
        this.config.THREADS_MAX_REQUESTS_PER_JOB,
      );
      if (!reserved) {
        truncated = true;
        break;
      }
      apiCalls += 1;
      const page = await this.client.searchKeyword({
        query: task.keyword,
        since: windowStart,
        until: windowEnd,
        limit: Math.min(this.config.THREADS_PAGE_SIZE, remaining),
        afterCursor,
      });
      const mapped = page.items.flatMap((item) => {
        const post = mapThreadsRootPost(item, {
          keyword: task.keyword,
          matchMode: task.matchMode,
          windowStart,
          windowEnd,
        });
        return post ? [post] : [];
      });
      pagesFetched += 1;
      scanned += page.items.length;
      matched += mapped.length;
      saved += mapped.length;
      const persisted = await this.repository.savePage({
        task,
        posts: mapped,
        scannedDelta: page.items.length,
        scannedTotal: scanned,
        nextCursor: page.afterCursor,
        pagesFetched,
        apiCalls,
        matched,
        saved,
      });
      if (!persisted) return;
      if (!page.afterCursor || page.items.length === 0) break;
      if (page.afterCursor === afterCursor) {
        truncated = true;
        break;
      }
      afterCursor = page.afterCursor;
    }
    if (await this.repository.isTaskActive(task)) {
      await this.repository.completeTask(task, truncated);
    }
  }
}
