import type { WorkerConfig } from "../config.js";
import {
  ANALYSIS_SCHEMA_VERSION,
  PROMPT_VERSION,
  createAnalysisInputHash,
} from "./hash.js";
import type { SentimentProvider } from "./schema.js";
import { SentimentRepository } from "./repository.js";

export class SentimentWorker {
  private stopped = false;

  constructor(
    private readonly repository: SentimentRepository,
    private readonly provider: SentimentProvider,
    private readonly config: WorkerConfig,
  ) {}

  stop(): void {
    this.stopped = true;
  }

  async runOnce(): Promise<number> {
    const items = await this.repository.claimBatch(
      this.config.WORKER_BATCH_SIZE,
    );

    await Promise.all(
      items.map(async (item) => {
        const input = {
          entityType: item.entityType,
          entityId: item.entityId,
          text: item.text,
          postContext: item.postContext,
          topic: this.config.SENTIMENT_TOPIC,
        } as const;
        const inputHash = createAnalysisInputHash(input);

        try {
          const cached = await this.repository.findCachedAnalysis(
            inputHash,
            this.provider.name,
            this.provider.model,
            PROMPT_VERSION,
            ANALYSIS_SCHEMA_VERSION,
          );
          const result = cached ?? (await this.provider.analyze(input));

          await this.repository.complete({
            queueItem: item,
            result,
            inputHash,
            provider: this.provider.name,
            model: this.provider.model,
            promptVersion: PROMPT_VERSION,
            schemaVersion: ANALYSIS_SCHEMA_VERSION,
            reviewThreshold:
              this.config.SENTIMENT_CONFIDENCE_REVIEW_THRESHOLD,
          });
        } catch (error) {
          await this.repository.fail(
            item,
            error,
            this.config.WORKER_MAX_ATTEMPTS,
          );
        }
      }),
    );

    return items.length;
  }

  async runForever(): Promise<void> {
    while (!this.stopped) {
      const processed = await this.runOnce();
      if (processed === 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.config.WORKER_POLL_MS),
        );
      }
    }
  }
}
