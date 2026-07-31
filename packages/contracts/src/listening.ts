import { z } from "zod";
import {
  canonicalContentUrlSchema,
  idSchema,
  isoDateTimeSchema,
  platformSchema,
  sentimentLabelSchema,
  timeParseStatusSchema,
} from "./common.js";
import { authorSchema } from "./privacy.js";

const contentBaseShape = {
  externalId: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(200_000),
  publishedAt: isoDateTimeSchema.nullable(),
  collectedAt: isoDateTimeSchema,
  timeParseStatus: timeParseStatusSchema,
};

function hasConsistentPublishedTime(value: {
  publishedAt: string | null;
  timeParseStatus: "parsed" | "unknown";
}): boolean {
  return value.timeParseStatus === "parsed"
    ? value.publishedAt !== null
    : value.publishedAt === null;
}

export const ingestPostSchema = z
  .object({
    ...contentBaseShape,
    sourceId: idSchema.optional(),
    sourceExternalId: z.string().trim().min(1).max(500).optional(),
    url: canonicalContentUrlSchema,
    author: authorSchema,
    matchedKeywordIds: z.array(idSchema).max(100).default([]),
  })
  .strict()
  .refine(
    (value) => value.sourceId !== undefined || value.sourceExternalId !== undefined,
    "sourceId or sourceExternalId is required",
  )
  .refine(hasConsistentPublishedTime, {
    message: "publishedAt must exist exactly when timeParseStatus is parsed",
    path: ["publishedAt"],
  });

export const ingestCommentSchema = z
  .object({
    ...contentBaseShape,
    postExternalId: z.string().trim().min(1).max(500),
    parentCommentExternalId: z.string().trim().min(1).max(500).nullable().optional(),
    observedOrder: z.number().int().nonnegative().max(100_000).optional(),
    url: canonicalContentUrlSchema.nullable().optional(),
    author: authorSchema,
  })
  .strict()
  .refine(hasConsistentPublishedTime, {
    message: "publishedAt must exist exactly when timeParseStatus is parsed",
    path: ["publishedAt"],
  });

export const sentimentViewSchema = z
  .object({
    label: sentimentLabelSchema,
    confidence: z.number().min(0).max(1),
    isRelevant: z.boolean(),
    needsReview: z.boolean(),
  })
  .strict()
  .nullable();

export const matchedKeywordViewSchema = z
  .object({
    id: idSchema,
    value: z.string().min(1).max(200),
    matchMode: z.enum(["whole_word", "contains_phrase"]),
  })
  .strict();

export const listeningFilterSchema = z
  .object({
    platform: platformSchema.optional(),
    sourceId: idSchema.optional(),
    keywordId: idSchema.optional(),
    sentiment: sentimentLabelSchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    includeUnknownTime: z.enum(["true", "false"]).default("false"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();

export const postViewSchema = z
  .object({
    id: idSchema,
    platform: platformSchema,
    externalId: z.string(),
    sourceId: idSchema,
    sourceName: z.string(),
    url: canonicalContentUrlSchema,
    body: z.string(),
    publishedAt: isoDateTimeSchema.nullable(),
    collectedAt: isoDateTimeSchema,
    timeParseStatus: timeParseStatusSchema,
    author: authorSchema,
    matchedKeywords: z.array(matchedKeywordViewSchema),
    sentiment: sentimentViewSchema,
  })
  .strict();

export const commentPostContextSchema = z
  .object({
    id: idSchema,
    externalId: z.string().min(1).max(500),
    sourceId: idSchema,
    sourceName: z.string().min(1).max(500),
    url: canonicalContentUrlSchema,
    body: z.string(),
    publishedAt: isoDateTimeSchema.nullable(),
    collectedAt: isoDateTimeSchema,
    timeParseStatus: timeParseStatusSchema,
    author: authorSchema,
    matchedKeywords: z.array(matchedKeywordViewSchema),
    sentiment: sentimentViewSchema,
  })
  .strict();

export const commentViewSchema = z
  .object({
    id: idSchema,
    platform: platformSchema,
    externalId: z.string(),
    postId: idSchema,
    postExternalId: z.string(),
    post: commentPostContextSchema,
    parentCommentId: idSchema.nullable(),
    observedOrder: z.number().int().nonnegative().nullable(),
    sourceId: idSchema,
    sourceName: z.string(),
    url: canonicalContentUrlSchema.nullable(),
    body: z.string(),
    publishedAt: isoDateTimeSchema.nullable(),
    collectedAt: isoDateTimeSchema,
    timeParseStatus: timeParseStatusSchema,
    author: authorSchema,
    sentiment: sentimentViewSchema,
  })
  .strict();

export const sentimentOverrideSchema = z
  .object({
    label: sentimentLabelSchema,
    reason: z.string().trim().min(3).max(1_000),
  })
  .strict();
