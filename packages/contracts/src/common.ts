import { z } from "zod";

export const idSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const platformSchema = z.enum(["facebook", "tiktok", "threads"]);
export const facebookPlatformSchema = z.literal("facebook");
export const sentimentLabelSchema = z.enum(["positive", "negative", "neutral"]);
export const authorKindSchema = z.enum(["real", "anonymous", "unknown"]);
export const lookbackPresetSchema = z.enum([
  "today",
  "3_days",
  "7_days",
  "30_days",
]);
export const matchModeSchema = z.enum(["whole_word", "contains_phrase"]);
export const coverageStatusSchema = z.enum(["complete", "partial", "unknown"]);
export const timeParseStatusSchema = z.enum(["parsed", "unknown"]);

export const emptyObjectSchema = z.object({}).strict();

export const requestIdHeaderSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const canonicalContentUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }, "Only HTTP(S) content URLs are accepted");

export const progressSchema = z
  .object({
    stage: z.string().trim().min(1).max(64),
    currentSource: z.string().trim().min(1).max(500).nullable().optional(),
    sourcesTotal: z.number().int().nonnegative().optional(),
    sourcesDone: z.number().int().nonnegative().optional(),
    tasksTotal: z.number().int().nonnegative().optional(),
    tasksDone: z.number().int().nonnegative().optional(),
    postsScanned: z.number().int().nonnegative().optional(),
    postsMatched: z.number().int().nonnegative().optional(),
    postsSaved: z.number().int().nonnegative().optional(),
    commentsSaved: z.number().int().nonnegative().optional(),
    sentimentTotal: z.number().int().nonnegative().optional(),
    sentimentDone: z.number().int().nonnegative().optional(),
    lastHeartbeatAt: isoDateTimeSchema.nullable().optional(),
  })
  .strict();

export type Platform = z.infer<typeof platformSchema>;
export type LookbackPreset = z.infer<typeof lookbackPresetSchema>;
export type SentimentLabel = z.infer<typeof sentimentLabelSchema>;
export type Progress = z.infer<typeof progressSchema>;
