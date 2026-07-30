import { z } from "zod";
import {
  canonicalContentUrlSchema,
  coverageStatusSchema,
  idSchema,
  isoDateTimeSchema,
  platformSchema,
} from "./common.js";

export const sourceSchema = z
  .object({
    id: idSchema,
    platform: platformSchema,
    externalId: z.string().trim().min(1).max(500),
    name: z.string().trim().min(1).max(500),
    canonicalUrl: canonicalContentUrlSchema,
    active: z.boolean(),
    selected: z.boolean(),
    lastDiscoveredAt: isoDateTimeSchema.nullable(),
    lastCrawlError: z.string().max(2_000).nullable(),
  })
  .strict();

export const sourceIngestItemSchema = z
  .object({
    externalId: z.string().trim().min(1).max(500).optional(),
    name: z.string().trim().min(1).max(500),
    canonicalUrl: canonicalContentUrlSchema,
  })
  .strict();

export const sourceListQuerySchema = z
  .object({
    platform: platformSchema.default("facebook"),
    search: z.string().trim().max(200).optional(),
    selected: z.enum(["true", "false"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();

export const updateSourceSelectionSchema = z
  .object({
    platform: platformSchema,
    sourceIds: z.array(idSchema).max(50),
  })
  .strict();

export const discoveryCompletionSchema = z
  .object({
    coverageStatus: coverageStatusSchema,
    partialReason: z.string().trim().min(1).max(2_000).nullable().optional(),
  })
  .strict();
