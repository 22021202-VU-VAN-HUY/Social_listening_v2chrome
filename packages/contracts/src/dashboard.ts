import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  platformSchema,
  sentimentLabelSchema,
} from "./common.js";

export const dashboardFilterSchema = z
  .object({
    platform: platformSchema.optional(),
    sourceId: idSchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .strict();

export const dashboardSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    posts: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    replies: z.number().int().nonnegative(),
    unknownTime: z.number().int().nonnegative(),
    relevant: z.number().int().nonnegative(),
    positive: z.number().int().nonnegative(),
    negative: z.number().int().nonnegative(),
    neutral: z.number().int().nonnegative(),
    pendingAnalysis: z.number().int().nonnegative(),
  })
  .strict();

export const dashboardTimelinePointSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: sentimentLabelSchema,
    count: z.number().int().nonnegative(),
  })
  .strict();
