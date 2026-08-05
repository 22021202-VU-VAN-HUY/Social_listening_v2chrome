import { z } from "zod";
import {
  checksumSchema,
  coverageStatusSchema,
  idSchema,
  isoDateTimeSchema,
  progressSchema,
} from "./common.js";
import { ingestCommentSchema, ingestPostSchema } from "./listening.js";
import { sourceIngestItemSchema } from "./sources.js";

export const createPairingCodeSchema = z.object({}).strict();

export const pairingCodeResponseSchema = z
  .object({
    code: z.string().regex(/^[A-Z0-9]{8}$/),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const pairExtensionSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}$/),
    installationId: z.string().trim().min(16).max(200),
    extensionVersion: z.string().trim().min(1).max(50),
  })
  .strict();

export const pairExtensionResponseSchema = z
  .object({
    deviceId: idSchema,
    deviceToken: z.string().min(32),
    workspaceId: idSchema,
  })
  .strict();

export const deviceRuntimeStatusSchema = z.enum([
  "online",
  "running",
  "needs_login",
]);

export const extensionHeartbeatSchema = z
  .object({
    deviceId: idSchema,
    extensionVersion: z.string().trim().min(1).max(50),
    status: deviceRuntimeStatusSchema,
    jobId: idSchema.optional(),
    leaseToken: z.string().min(32).max(256).optional(),
    fencingToken: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const leaseParts = [
      value.jobId !== undefined,
      value.leaseToken !== undefined,
      value.fencingToken !== undefined,
    ];
    if (leaseParts.some(Boolean) && !leaseParts.every(Boolean)) {
      context.addIssue({
        code: "custom",
        message: "jobId, leaseToken, and fencingToken must be supplied together",
      });
    }
  });

export const heartbeatResponseSchema = z
  .object({
    serverTime: isoDateTimeSchema,
    leaseExpiresAt: isoDateTimeSchema.optional(),
    cancelRequested: z.boolean(),
    availableJobId: idSchema.optional(),
  })
  .strict();

export const claimJobSchema = z
  .object({
    deviceId: idSchema,
    extensionVersion: z.string().trim().min(1).max(50),
  })
  .strict();

export const claimJobResponseSchema = z
  .object({
    jobId: idSchema,
    leaseToken: z.string().min(32),
    fencingToken: z.number().int().positive(),
    leaseExpiresAt: isoDateTimeSchema,
    snapshot: z.record(z.string(), z.unknown()),
  })
  .strict();

const leaseProofShape = {
  deviceId: idSchema,
  leaseToken: z.string().min(32).max(256),
  fencingToken: z.number().int().positive(),
};

export const knownPostsRequestSchema = z
  .object({
    ...leaseProofShape,
    urls: z.array(z.string().url().max(2_000)).min(1).max(500),
  })
  .strict();

export const knownPostsResponseSchema = z
  .object({
    knownUrls: z.array(z.string().url().max(2_000)).max(500),
  })
  .strict();

const batchBaseShape = {
  ...leaseProofShape,
  checksum: checksumSchema,
  taskId: idSchema.optional(),
  checkpoint: z.record(z.string(), z.unknown()).optional(),
};

export const sourceBatchSchema = z
  .object({
    ...batchBaseShape,
    kind: z.literal("sources"),
    sources: z.array(sourceIngestItemSchema).min(1).max(200),
  })
  .strict();

export const contentBatchSchema = z
  .object({
    ...batchBaseShape,
    taskId: idSchema,
    kind: z.literal("content"),
    posts: z.array(ingestPostSchema).max(100),
    comments: z.array(ingestCommentSchema).max(500),
  })
  .strict()
  .refine(
    (value) => value.posts.length + value.comments.length > 0,
    "A content batch cannot be empty",
  );

export const ingestBatchSchema = z.discriminatedUnion("kind", [
  sourceBatchSchema,
  contentBatchSchema,
]);

export const extensionEventSchema = z
  .object({
    ...leaseProofShape,
    taskId: idSchema.optional(),
    level: z.enum(["debug", "info", "warn", "error"]),
    type: z.string().trim().min(1).max(100),
    payload: z.record(z.string(), z.unknown()).default({}),
    progress: progressSchema.optional(),
  })
  .strict();

export const completeJobSchema = z
  .object({
    ...leaseProofShape,
    outcome: z.enum(["crawl_complete", "partial"]),
    coverageStatus: coverageStatusSchema.optional(),
    partialReason: z.string().trim().min(1).max(2_000).optional(),
    progress: progressSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome === "partial" && !value.partialReason) {
      context.addIssue({
        code: "custom",
        message: "partialReason is required for a partial outcome",
      });
    }
  });

export const failJobSchema = z
  .object({
    ...leaseProofShape,
    status: z.enum(["failed", "needs_login", "interrupted"]),
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(2_000),
    retryable: z.boolean(),
  })
  .strict();

export const batchAckSchema = z
  .object({
    duplicate: z.boolean(),
    accepted: z
      .object({
        sources: z.number().int().nonnegative(),
        posts: z.number().int().nonnegative(),
        comments: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
