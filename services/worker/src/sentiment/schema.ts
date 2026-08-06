import { z } from "zod";

export const SentimentLabelSchema = z.enum([
  "positive",
  "negative",
  "neutral",
]);

export const SentimentResultSchema = z.object({
  isRelevant: z.boolean(),
  label: SentimentLabelSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(500),
  language: z.string().trim().min(2).max(12).default("vi"),
});

export const SentimentBatchResultSchema = z.object({
  results: z
    .array(
      SentimentResultSchema.extend({
        entityId: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(50),
});

export type SentimentLabel = z.infer<typeof SentimentLabelSchema>;
export type SentimentResult = z.infer<typeof SentimentResultSchema>;
export type SentimentBatchResult = z.infer<
  typeof SentimentBatchResultSchema
>["results"];

export interface SentimentInput {
  entityType: "post" | "comment";
  entityId: string;
  text: string;
  postContext?: string | null;
  conversationContext?: string | null;
  topic: string;
}

export interface SentimentProvider {
  readonly name: string;
  readonly model: string;
  analyze(input: SentimentInput): Promise<SentimentResult>;
  analyzeBatch(inputs: SentimentInput[]): Promise<SentimentBatchResult>;
}

export interface SentimentQueueItem {
  id: string;
  workspaceId: string;
  jobId: string | null;
  entityType: "post" | "comment";
  entityId: string;
  text: string;
  postContext: string | null;
  conversationContext: string | null;
  conversationGroupId: string | null;
  attemptCount: number;
}
