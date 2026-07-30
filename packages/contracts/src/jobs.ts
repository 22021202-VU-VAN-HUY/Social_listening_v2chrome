import { z } from "zod";
import {
  facebookPlatformSchema,
  idSchema,
  isoDateTimeSchema,
  lookbackPresetSchema,
  platformSchema,
  progressSchema,
} from "./common.js";

export const jobTypeSchema = z.enum([
  "discover_sources",
  "crawl_content",
  "analyze_sentiment",
  "rebuild_aggregates",
  "delete_expired_data",
]);

export const jobStatusSchema = z.enum([
  "queued",
  "waiting_extension",
  "running",
  "processing_ai",
  "interrupted",
  "needs_login",
  "partial",
  "cancelled",
  "failed",
  "completed",
]);

export const createDiscoverSourcesJobSchema = z
  .object({
    platform: facebookPlatformSchema.default("facebook"),
    deviceId: idSchema.optional(),
  })
  .strict();

export const createCrawlJobSchema = z
  .object({
    platform: facebookPlatformSchema.default("facebook"),
    deviceId: idSchema.optional(),
    sourceIds: z.array(idSchema).min(1).max(50).optional(),
    keywordIds: z.array(idSchema).min(1).max(100).optional(),
    lookbackPreset: lookbackPresetSchema.optional(),
  })
  .strict();

export const jobSnapshotSchema = z
  .object({
    sourceIds: z.array(idSchema),
    keywordIds: z.array(idSchema),
    keywords: z.array(
      z
        .object({
          id: idSchema,
          value: z.string().min(1).max(200),
          normalizedValue: z.string().min(1).max(200),
          matchMode: z.enum(["whole_word", "contains_phrase"]),
        })
        .strict(),
    ),
    windowStartUtc: isoDateTimeSchema,
    windowEndUtc: isoDateTimeSchema,
    timezone: z.string().min(1).max(100),
    lookbackPreset: lookbackPresetSchema,
    crawlComments: z.literal(true),
    limits: z
      .object({
        maxSourcesPerJob: z.number().int().positive(),
        maxPostsPerSource: z.number().int().positive(),
        maxCommentsPerPost: z.number().int().positive(),
        maxRuntimeMinutes: z.number().int().positive(),
      })
      .strict(),
    adapterVersion: z.string().min(1).max(100),
  })
  .strict();

export const jobSchema = z
  .object({
    id: idSchema,
    type: jobTypeSchema,
    platform: platformSchema,
    status: jobStatusSchema,
    cancelRequested: z.boolean(),
    settingsSnapshot: z.record(z.string(), z.unknown()),
    progress: progressSchema,
    errorCode: z.string().max(100).nullable(),
    errorMessage: z.string().max(2_000).nullable(),
    createdAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.nullable(),
    completedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const jobEventsQuerySchema = z
  .object({
    after: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export const jobEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    level: z.enum(["debug", "info", "warn", "error"]),
    type: z.string().trim().min(1).max(100),
    payload: z.record(z.string(), z.unknown()),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const cancelJobSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
