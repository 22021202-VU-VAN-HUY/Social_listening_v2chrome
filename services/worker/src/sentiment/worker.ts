import type { WorkerConfig } from "../config.js";
import {
  ANALYSIS_SCHEMA_VERSION,
  PROMPT_VERSION,
  createAnalysisInputHash,
} from "./hash.js";
import type {
  SentimentProvider,
  SentimentQueueItem,
  SentimentResult,
} from "./schema.js";
import { parseConversationSegment } from "./conversation.js";
import { SentimentRepository } from "./repository.js";

function conversationGroupKey(item: SentimentQueueItem): string {
  if (item.entityType === "post") return `post:${item.entityId}`;
  if (item.conversationGroupId) {
    return `comment:${item.conversationGroupId}`;
  }
  const segment = parseConversationSegment(item.conversationContext);
  const root = segment.items.find(
    (entry) => entry.entityId && entry.parentEntityId === null,
  );
  return `comment:${root?.entityId ?? item.entityId}`;
}

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

    const groups = new Map<string, SentimentQueueItem[]>();
    for (const item of items) {
      const key = conversationGroupKey(item);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }

    await Promise.all(
      [...groups.values()].map(async (group) => {
        const prepared = group.map((item) => {
          const input = {
            entityType: item.entityType,
            entityId: item.entityId,
            text: item.text,
            postContext: item.postContext,
            conversationContext: item.conversationContext,
            topic: this.config.SENTIMENT_TOPIC,
          } as const;
          return {
            item,
            input,
            inputHash: createAnalysisInputHash(input),
          };
        });

        const cachedResults = await Promise.all(
          prepared.map(({ inputHash }) =>
            this.repository.findCachedAnalysis(
              inputHash,
              this.provider.name,
              this.provider.model,
              PROMPT_VERSION,
              ANALYSIS_SCHEMA_VERSION,
            ),
          ),
        );
        const results = new Map<string, SentimentResult>();
        const missing = prepared.filter((_, index) => {
          const cached = cachedResults[index];
          if (cached) results.set(prepared[index]!.item.entityId, cached);
          return !cached;
        });

        if (missing.length > 0) {
          try {
            const analyzed = await this.provider.analyzeBatch(
              missing.map(({ input }) => input),
            );
            for (const result of analyzed) {
              results.set(result.entityId, result);
            }
          } catch (error) {
            await Promise.all(
              missing.map(({ item }) =>
                this.repository.fail(
                  item,
                  error,
                  this.config.WORKER_MAX_ATTEMPTS,
                ),
              ),
            );
          }
        }

        await Promise.all(
          prepared.map(async ({ item, inputHash }) => {
            const result = results.get(item.entityId);
            if (!result) return;
            try {
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
