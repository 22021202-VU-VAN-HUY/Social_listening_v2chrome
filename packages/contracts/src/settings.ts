import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  lookbackPresetSchema,
  matchModeSchema,
  platformSchema,
} from "./common.js";

export const platformSettingsSchema = z
  .object({
    platform: platformSchema,
    lookbackPreset: lookbackPresetSchema,
    crawlComments: z.literal(true),
    maxSourcesPerJob: z.number().int().min(1).max(50),
    maxPostsPerSource: z.number().int().min(1).max(300),
    maxCommentsPerPost: z.number().int().min(1).max(500),
    maxRuntimeMinutes: z.number().int().min(1).max(120),
    enabled: z.boolean(),
  })
  .strict();

export const updatePlatformSettingsSchema = platformSettingsSchema
  .omit({ platform: true })
  .strict();

export const keywordSchema = z
  .object({
    id: idSchema,
    platform: platformSchema,
    value: z.string().trim().min(1).max(200),
    normalizedValue: z.string().min(1).max(200),
    matchMode: matchModeSchema,
    active: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const createKeywordSchema = z
  .object({
    platform: platformSchema.default("facebook"),
    value: z.string().trim().min(1).max(200),
    matchMode: matchModeSchema.default("contains_phrase"),
    active: z.boolean().default(true),
  })
  .strict();

export const updateKeywordSchema = z
  .object({
    value: z.string().trim().min(1).max(200).optional(),
    matchMode: matchModeSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one change is required");

export const keywordListQuerySchema = z
  .object({
    platform: platformSchema.optional(),
    active: z.enum(["true", "false"]).optional(),
  })
  .strict();

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export type CreateKeyword = z.infer<typeof createKeywordSchema>;
