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

export type SentimentLabel = z.infer<typeof SentimentLabelSchema>;
export type SentimentResult = z.infer<typeof SentimentResultSchema>;

export interface SentimentInput {
  entityType: "post" | "comment";
  entityId: string;
  text: string;
  postContext?: string | null;
  topic: string;
}

export interface SentimentProvider {
  readonly name: string;
  readonly model: string;
  analyze(input: SentimentInput): Promise<SentimentResult>;
}

export interface SentimentQueueItem {
  id: string;
  workspaceId: string;
  jobId: string | null;
  entityType: "post" | "comment";
  entityId: string;
  text: string;
  postContext: string | null;
  attemptCount: number;
}
