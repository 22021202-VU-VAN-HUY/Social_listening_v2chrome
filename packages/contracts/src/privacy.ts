import { z } from "zod";
import { authorKindSchema } from "./common.js";

const forbiddenAuthorNamePatterns = [
  /^@[\p{L}\p{N}_.-]+$/u,
  /(?:https?:\/\/|www\.)/iu,
  /(?:facebook\.com|fb\.com|tiktok\.com|threads\.net)\//iu,
];

export const authorNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => forbiddenAuthorNamePatterns.every((pattern) => !pattern.test(value)),
    "authorName must be a display name, never a handle or profile URL",
  );

const realAuthorSchema = z
  .object({
    authorName: authorNameSchema,
    isAnonymous: z.literal(false),
    authorKind: z.literal("real"),
    anonymousAvatarVariant: z.null().optional(),
  })
  .strict();

const anonymousAuthorSchema = z
  .object({
    authorName: z.null(),
    isAnonymous: z.literal(true),
    authorKind: z.literal("anonymous"),
    anonymousAvatarVariant: z.number().int().min(0).max(7).optional(),
  })
  .strict();

const unknownAuthorSchema = z
  .object({
    authorName: z.null(),
    isAnonymous: z.literal(false),
    authorKind: z.literal("unknown"),
    anonymousAvatarVariant: z.null().optional(),
  })
  .strict();

/**
 * The only author data accepted by the system. Strict objects intentionally
 * reject profile URLs, platform IDs, handles, usernames, and tracking fields.
 */
export const authorSchema = z.discriminatedUnion("authorKind", [
  realAuthorSchema,
  anonymousAuthorSchema,
  unknownAuthorSchema,
]);

export const authorStorageSchema = z
  .object({
    author_name: authorNameSchema.nullable(),
    is_anonymous: z.boolean(),
    author_kind: authorKindSchema,
    anonymous_avatar_variant: z.number().int().min(0).max(7).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.author_kind === "anonymous") {
      if (!value.is_anonymous || value.author_name !== null) {
        context.addIssue({
          code: "custom",
          message: "Anonymous authors cannot carry a name",
        });
      }
      return;
    }

    if (value.is_anonymous) {
      context.addIssue({
        code: "custom",
        message: "is_anonymous is only valid for author_kind=anonymous",
      });
    }

    if (value.anonymous_avatar_variant !== null && value.anonymous_avatar_variant !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Anonymous avatar variants are only valid for anonymous authors",
      });
    }

    if (value.author_kind === "real" && value.author_name === null) {
      context.addIssue({
        code: "custom",
        message: "Real authors require a display name",
      });
    }

    if (value.author_kind === "unknown" && value.author_name !== null) {
      context.addIssue({
        code: "custom",
        message: "Unknown authors cannot carry a name",
      });
    }
  });

export type Author = z.infer<typeof authorSchema>;
